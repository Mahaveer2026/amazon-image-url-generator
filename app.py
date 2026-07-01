from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

import os
import io
import uuid
import pandas as pd
from io import BytesIO

app = Flask(__name__)

# -------------------------------
# CONFIG
# -------------------------------

SCOPES = ["https://www.googleapis.com/auth/drive"]

SERVICE_ACCOUNT_FILE = "/etc/secrets/google_credentials.json"

FOLDER_ID = os.getenv("GOOGLE_DRIVE_FOLDER_ID")

ALLOWED_EXTENSIONS = {
    "jpg",
    "jpeg",
    "png",
    "webp"
}

MAX_FILE_SIZE = 20 * 1024 * 1024

excel_data = []

# -------------------------------
# GOOGLE AUTH
# -------------------------------

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE,
    scopes=SCOPES
)

drive_service = build(
    "drive",
    "v3",
    credentials=credentials
)

# -------------------------------
# HELPERS
# -------------------------------

def allowed_file(filename):
    return (
        "." in filename and
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


def auto_filename(filename):
    name, ext = os.path.splitext(filename)
    uid = uuid.uuid4().hex[:8]
    return f"{name}_{uid}{ext}"


# -------------------------------
# GOOGLE DRIVE UPLOAD
# -------------------------------

def upload_to_drive(file):

    filename = auto_filename(
        secure_filename(file.filename)
    )

    file.seek(0)

    media = MediaIoBaseUpload(
        io.BytesIO(file.read()),
        mimetype=file.content_type,
        resumable=False
    )

    metadata = {
        "name": filename,
        "parents": [FOLDER_ID]
    }

    uploaded = drive_service.files().create(
        body=metadata,
        media_body=media,
        fields="id"
    ).execute()

    file_id = uploaded["id"]

    drive_service.permissions().create(
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
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():

    if "images" not in request.files:
        return jsonify({
            "success": False,
            "message": "No images selected."
        })

    files = request.files.getlist("images")

    uploaded = []

    for file in files:

        if file.filename == "":
            continue

        if not allowed_file(file.filename):
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

    return jsonify({
        "success": True,
        "files": uploaded
    })


@app.route("/download")
def download():

    if len(excel_data) == 0:
        return "No Data"

    df = pd.DataFrame(excel_data)

    output = BytesIO()

    df.to_excel(
        output,
        index=False
    )

    output.seek(0)

    return send_file(
        output,
        download_name="amazon_image_links.xlsx",
        as_attachment=True,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


if __name__ == "__main__":
    app.run(debug=True)
