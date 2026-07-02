"""
Amazon Image Link Generator
----------------------------
Flask backend that uploads images to Google Drive (Service Account),
makes them public, and returns direct viewable image URLs.
Also exports an Excel report of Image Name / Image URL.
"""

from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseUpload

import os
import io
import uuid
import logging
import pandas as pd
from io import BytesIO

# -------------------------------
# APP INIT
# -------------------------------

app = Flask(__name__)

# Limit total request size (20 MB per file * reasonable batch cap = 100 MB)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# -------------------------------
# CONFIG
# -------------------------------

SCOPES = ["https://www.googleapis.com/auth/drive"]

SERVICE_ACCOUNT_FILE = "/etc/secrets/google_credentials.json"

FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID")

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB per image

# In-memory store for the Excel export (Image Name / Image URL rows).
# NOTE: resets on server restart / redeploy - fine for this lightweight tool.
excel_data = []

# -------------------------------
# GOOGLE DRIVE SERVICE (lazy-loaded)
# -------------------------------
# We do NOT build the Drive client at import time. If the credentials file
# or folder ID is missing, importing app.py (e.g. during local dev, testing,
# or a bad deploy) would crash the whole app before Flask even starts.
# Instead we build it lazily on first use and surface a clean JSON error.

_drive_service = None


def get_drive_service():
    """Return a cached Google Drive API client, building it on first call."""
    global _drive_service

    if _drive_service is not None:
        return _drive_service

    if not os.path.exists(SERVICE_ACCOUNT_FILE):
        raise RuntimeError(
            f"Google service account file not found at {SERVICE_ACCOUNT_FILE}. "
            "Make sure the secret file is mounted on the server."
        )

    if not FOLDER_ID:
        raise RuntimeError(
            "GOOGLE_DRIVE_FOLDER_ID environment variable is not set."
        )

    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=SCOPES
    )

    _drive_service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    return _drive_service


# -------------------------------
# HELPERS
# -------------------------------

def allowed_file(filename):
    """Check extension is one of the allowed image types."""
    return (
        "." in filename and
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def get_file_size(file_storage):
    """Determine file size in bytes without permanently losing the stream position."""
    file_storage.stream.seek(0, os.SEEK_END)
    size = file_storage.stream.tell()
    file_storage.stream.seek(0)
    return size


def unique_filename(filename):
    """
    Auto-rename to avoid duplicate filenames on Drive.
    Keeps the original name for readability and appends a short unique id.
    """
    name, ext = os.path.splitext(filename)
    uid = uuid.uuid4().hex[:8]
    return f"{name}_{uid}{ext}"


# -------------------------------
# GOOGLE DRIVE UPLOAD
# -------------------------------

def upload_to_drive(file_storage):
    """
    Upload a single werkzeug FileStorage object to Google Drive,
    make it publicly readable, and return (filename, direct_url).
    Raises exceptions on failure - caller is responsible for catching them.
    """
    service = get_drive_service()

    filename = unique_filename(secure_filename(file_storage.filename))

    file_storage.stream.seek(0)
    file_bytes = file_storage.read()

    media = MediaIoBaseUpload(
        io.BytesIO(file_bytes),
        mimetype=file_storage.content_type or "application/octet-stream",
        resumable=False
    )

    metadata = {
        "name": filename,
        "parents": [FOLDER_ID]
    }

    uploaded = service.files().create(
        body=metadata,
        media_body=media,
        fields="id"
    ).execute()

    file_id = uploaded["id"]

    # Make the file publicly viewable
    service.permissions().create(
        fileId=file_id,
        body={
            "type": "anyone",
            "role": "reader"
        }
    ).execute()

    url = f"https://lh3.googleusercontent.com/d/{file_id}=s0"

    return filename, url


# -------------------------------
# ROUTES
# -------------------------------

@app.route("/")
def home():
    """Render the dashboard UI."""
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    """
    Accepts one or more images under the 'images' form field,
    uploads each to Google Drive, and returns JSON with per-file results.
    Never lets one bad file kill the whole batch.
    """
    if "images" not in request.files:
        return jsonify({
            "success": False,
            "message": "No images were submitted."
        }), 400

    files = request.files.getlist("images")
    files = [f for f in files if f and f.filename != ""]

    if not files:
        return jsonify({
            "success": False,
            "message": "No images selected."
        }), 400

    uploaded = []
    failed = []

    for file in files:
        original_name = file.filename

                try:
            if not allowed_file(original_name):
                failed.append({
                    "name": original_name,
                    "reason": "Unsupported file type. Allowed: jpg, jpeg, png, webp."
                })
                continue

            if get_file_size(file) > MAX_FILE_SIZE:
                failed.append({
                    "name": original_name,
                    "reason": "File exceeds 20 MB limit."
                })
                continue

            filename, url = upload_to_drive(file)

            excel_data.append({
                "Image Name": filename,
                "Image URL": url
            })

            uploaded.append({
                "name": filename,
                "url": url
            })

        except Exception as e:
            logger.exception(e)
            failed.append({
                "name": original_name,
                "reason": str(e)
            })

        except RuntimeError as e:
            logger.error("Configuration error: %s", e)
            return jsonify({
                "success": False,
                "message": str(e)
            }), 500

        except Exception as e:
            logger.exception(e)
            failed.append({
                "name": original_name,
                "reason": str(e)
            })
    if not uploaded and failed:
        return jsonify({
            "success": False,
            "message": "All uploads failed.",
            "files": [],
            "failed": failed
        }), 502

    return jsonify({
        "success": True,
        "files": uploaded,
        "failed": failed
    })


@app.route("/download")
def download():
    """Generate and stream amazon_image_links.xlsx containing all uploads so far."""
    if len(excel_data) == 0:
        return jsonify({
            "success": False,
            "message": "No uploaded images yet. Upload images first."
        }), 404

    df = pd.DataFrame(excel_data, columns=["Image Name", "Image URL"])

    output = BytesIO()
    df.to_excel(output, index=False, sheet_name="Images")
    output.seek(0)

    return send_file(
        output,
        download_name="amazon_image_links.xlsx",
        as_attachment=True,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


@app.errorhandler(413)
def file_too_large(e):
    return jsonify({
        "success": False,
        "message": "Upload too large. Please upload smaller or fewer files."
    }), 413


@app.errorhandler(404)
def not_found(e):
    return jsonify({
        "success": False,
        "message": "Route not found."
    }), 404


@app.errorhandler(500)
def server_error(e):
    logger.exception("Internal server error")
    return jsonify({
        "success": False,
        "message": "Internal server error."
    }), 500


if __name__ == "__main__":
    app.run(debug=True)
