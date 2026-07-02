/**
 * Amazon Image Link Generator - frontend logic
 * Handles: drag & drop, pre-upload previews, AJAX upload with progress,
 * rendering result cards, copy-to-clipboard (single + all), toast messages.
 */

document.addEventListener("DOMContentLoaded", () => {

  // -------------------------------
  // ELEMENT REFERENCES
  // -------------------------------
  const dropArea        = document.getElementById("dropArea");
  const fileInput        = document.getElementById("images");
  const uploadForm        = document.getElementById("uploadForm");
  const uploadBtn        = document.getElementById("uploadBtn");
  const previewArea      = document.getElementById("previewArea");

  const progressContainer = document.getElementById("progressContainer");
  const progressBar      = document.getElementById("progressBar");

  const imageList        = document.getElementById("imageList");
  const emptyState        = document.getElementById("emptyState");
  const copyAllBtn        = document.getElementById("copyAll");
  const downloadExcelBtn  = document.getElementById("downloadExcel");
  const toastMessage      = document.getElementById("toastMessage");

  // Keep track of every uploaded URL for "Copy All"
  let uploadedUrls = [];
  let selectedFiles = [];

  // -------------------------------
  // TOAST HELPER
  // -------------------------------
  let toastTimer = null;
  function showToast(message, type = "success") {
    toastMessage.textContent = message;
    toastMessage.style.background = type === "error" ? "#dc3545" : "#198754";
    toastMessage.style.display = "block";

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMessage.style.display = "none";
    }, 2500);
  }

  // -------------------------------
  // DRAG & DROP HANDLING
  // -------------------------------
  ["dragenter", "dragover"].forEach(evt => {
    dropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(evt => {
    dropArea.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropArea.classList.remove("dragover");
    });
  });

  dropArea.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      addFiles(dt.files);
    }
  });

  // Clicking the drop area (but not the native input itself) opens file picker
  dropArea.addEventListener("click", (e) => {
    if (e.target !== fileInput) {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    addFiles(fileInput.files);
  });

  // -------------------------------
  // FILE SELECTION + PREVIEW
  // -------------------------------
  const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

  function addFiles(fileListLike) {
    const incoming = Array.from(fileListLike);

    incoming.forEach(file => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        showToast(`${file.name}: unsupported file type`, "error");
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name}: exceeds 20MB limit`, "error");
        return;
      }
      selectedFiles.push(file);
    });

    renderPreviews();
    syncFileInput();
  }

  function renderPreviews() {
    previewArea.innerHTML = "";

    if (selectedFiles.length === 0) {
      previewArea.classList.add("d-none");
      return;
    }

    previewArea.classList.remove("d-none");

    selectedFiles.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const col = document.createElement("div");
        col.className = "col-6 col-md-3";
        col.innerHTML = `
          <div class="preview-card position-relative">
            <img src="${e.target.result}" alt="${escapeHtml(file.name)}">
            <button type="button" class="btn-remove-preview" data-index="${index}" title="Remove">
              <i class="bi bi-x-lg"></i>
            </button>
            <div class="preview-name">${escapeHtml(file.name)}</div>
          </div>
        `;
        previewArea.appendChild(col);
      };
      reader.readAsDataURL(file);
    });
  }

  // Remove a file from the pending selection
  previewArea.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-remove-preview");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    selectedFiles.splice(index, 1);
    renderPreviews();
    syncFileInput();
  });

  // Keep the native <input type="file"> in sync with our selectedFiles array
  // so the actual form submission uses the same (possibly trimmed) list.
  function syncFileInput() {
    const dataTransfer = new DataTransfer();
    selectedFiles.forEach(file => dataTransfer.items.add(file));
    fileInput.files = dataTransfer.files;
  }

  // -------------------------------
  // UPLOAD (AJAX via XMLHttpRequest for progress events)
  // -------------------------------
  uploadForm.addEventListener("submit", (e) => {
    e.preventDefault();

    if (selectedFiles.length === 0) {
      showToast("Please select at least one image.", "error");
      return;
    }

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append("images", file));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/upload", true);

    // Show progress bar
    progressContainer.classList.remove("d-none");
    progressBar.style.width = "0%";
    progressBar.textContent = "0%";
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Uploading...`;

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = percent + "%";
        progressBar.textContent = percent + "%";
      }
    });

    xhr.onload = () => {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `<i class="bi bi-upload"></i> Upload Images`;
      progressContainer.classList.add("d-none");

      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (err) {
        showToast("Unexpected server response.", "error");
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300 && data.success) {
        handleUploadSuccess(data);
      } else {
        showToast(data.message || "Upload failed.", "error");
        if (data.failed && data.failed.length) {
          data.failed.forEach(f => showToast(`${f.name}: ${f.reason}`, "error"));
        }
      }

      // Reset selection after attempt
      selectedFiles = [];
      renderPreviews();
      fileInput.value = "";
    };

    xhr.onerror = () => {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = `<i class="bi bi-upload"></i> Upload Images`;
      progressContainer.classList.add("d-none");
      showToast("Network error during upload.", "error");
    };

    xhr.send(formData);
  });

  function handleUploadSuccess(data) {
    const { files = [], failed = [] } = data;

    if (files.length) {
      showToast(`${files.length} image(s) uploaded successfully.`);
      files.forEach(file => {
        uploadedUrls.push(file.url);
        appendImageCard(file.name, file.url);
      });
      copyAllBtn.disabled = uploadedUrls.length === 0;
      emptyState.classList.add("d-none");
    }

    if (failed.length) {
      failed.forEach(f => showToast(`${f.name}: ${f.reason}`, "error"));
    }
  }

  // -------------------------------
  // RESULT CARDS
  // -------------------------------
  function appendImageCard(name, url) {
    const col = document.createElement("div");
    col.className = "col-md-6 col-lg-4";
    col.innerHTML = `
      <div class="image-card">
        <img src="${url}" alt="${escapeHtml(name)}" loading="lazy">
        <div class="image-name">${escapeHtml(name)}</div>
        <input type="text" class="url-box" value="${url}" readonly>
        <button type="button" class="btn btn-outline-primary copy-btn" data-url="${url}">
          <i class="bi bi-clipboard"></i> Copy URL
        </button>
      </div>
    `;
    imageList.prepend(col);
  }

  imageList.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    copyToClipboard(btn.dataset.url);
    showToast("URL copied to clipboard!");
  });

  // -------------------------------
  // COPY ALL URLS
  // -------------------------------
  copyAllBtn.addEventListener("click", () => {
    if (uploadedUrls.length === 0) {
      showToast("No URLs to copy yet.", "error");
      return;
    }
    copyToClipboard(uploadedUrls.join("\n"));
    showToast(`Copied ${uploadedUrls.length} URL(s) to clipboard!`);
  });

  // -------------------------------
  // DOWNLOAD EXCEL
  // -------------------------------
  downloadExcelBtn.addEventListener("click", () => {
    if (uploadedUrls.length === 0) {
      showToast("Upload at least one image first.", "error");
      return;
    }
    window.location.href = "/download";
  });

  // -------------------------------
  // UTILITIES
  // -------------------------------
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
    } catch (err) {
      console.error("Copy failed", err);
    }
    document.body.removeChild(textarea);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

});
