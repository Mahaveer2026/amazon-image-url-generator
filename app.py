import os
import io
import json
import base64
import requests
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from flask_cors import CORS
from dotenv import load_dotenv
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

load_dotenv()

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def upload_to_imgbb(file_data, filename):
    api_key = os.getenv('IMGBB_API_KEY', '00425464bddb3195e439a8bfe3e0fed1')
    encoded = base64.b64encode(file_data).decode('utf-8')
    response = requests.post(
        'https://api.imgbb.com/1/upload',
        data={
            'key': api_key,
            'image': encoded,
            'name': filename,
        }
    )
    result = response.json()
    if result.get('success'):
        return result['data']['url']
    else:
        raise Exception(result.get('error', {}).get('message', 'Upload failed'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_images():
    if 'images' not in request.files:
        return jsonify({'error': 'No images provided'}), 400

    files = request.files.getlist('images')
    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No files selected'}), 400

    results, errors = [], []

    for file in files:
        if file.filename == '':
            continue
        if not allowed_file(file.filename):
            errors.append({'filename': file.filename, 'error': 'File type not supported'})
            continue

        try:
            ext = file.filename.rsplit('.', 1)[1].lower()
            data = file.read()
            url = upload_to_imgbb(data, file.filename)

            results.append({
                'filename': file.filename,
                'url': url,
                'size': len(data),
                'format': ext.upper(),
            })

        except Exception as e:
            errors.append({'filename': file.filename, 'error': str(e)})

    return jsonify({'success': results, 'errors': errors})

@app.route('/export-excel', methods=['POST'])
def export_excel():
    data = request.json
    if not data or not data.get('images'):
        return jsonify({'error': 'No data provided'}), 400

    images = data['images']
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = 'Amazon Image URLs'

    ORANGE, YELLOW, NAVY, WHITE, GREY = 'FF6B2B', 'FEBD69', '0F1923', 'FFFFFF', 'F8F9FB'
    thin = Side(style='thin', color='E0E0E0')
    bd = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.merge_cells('A1:D1')
    t = ws['A1']
    t.value = f'Amazon Product Image URLs  —  {datetime.now().strftime("%B %d, %Y  %H:%M")}'
    t.font = Font(name='Calibri', bold=True, size=13, color=WHITE)
    t.fill = PatternFill(start_color=NAVY, end_color=NAVY, fill_type='solid')
    t.alignment = Alignment(horizontal='left', vertical='center', indent=2)
    ws.row_dimensions[1].height = 32

    ws.merge_cells('A2:D2')
    s = ws['A2']
    s.value = f'{len(images)} image(s)  —  Ready for Amazon Seller Central bulk import'
    s.font = Font(name='Calibri', size=10, italic=True, color='555555')
    s.fill = PatternFill(start_color=YELLOW, end_color=YELLOW, fill_type='solid')
    s.alignment = Alignment(horizontal='left', vertical='center', indent=2)
    ws.row_dimensions[2].height = 22

    for i, (h, w, l) in enumerate(zip(
        ['#', 'Image Name', 'Image URL', 'Format'],
        [5, 38, 90, 10],
        ['A', 'B', 'C', 'D']
    ), 1):
        c = ws.cell(row=3, column=i, value=h)
        c.font = Font(name='Calibri', bold=True, size=11, color=WHITE)
        c.fill = PatternFill(start_color=ORANGE, end_color=ORANGE, fill_type='solid')
        c.alignment = Alignment(horizontal='center', vertical='center')
        c.border = bd
        ws.column_dimensions[l].width = w
    ws.row_dimensions[3].height = 26

    for idx, img in enumerate(images, 1):
        r = idx + 3
        fc = GREY if idx % 2 == 0 else WHITE
        rf = PatternFill(start_color=fc, end_color=fc, fill_type='solid')

        c1 = ws.cell(row=r, column=1, value=idx)
        c1.font = Font(name='Calibri', size=10, color='888888')
        c1.fill = rf; c1.alignment = Alignment(horizontal='center', vertical='center'); c1.border = bd

        c2 = ws.cell(row=r, column=2, value=img.get('filename', ''))
        c2.font = Font(name='Calibri', size=10, bold=True)
        c2.fill = rf; c2.alignment = Alignment(horizontal='left', vertical='center', indent=1); c2.border = bd

        url = img.get('url', '')
        c3 = ws.cell(row=r, column=3, value=url)
        c3.hyperlink = url
        c3.font = Font(name='Calibri', size=10, color='0563C1', underline='single')
        c3.fill = rf; c3.alignment = Alignment(horizontal='left', vertical='center', indent=1); c3.border = bd

        c4 = ws.cell(row=r, column=4, value=img.get('format', ''))
        c4.font = Font(name='Calibri', size=10, color='444444')
        c4.fill = rf; c4.alignment = Alignment(horizontal='center', vertical='center'); c4.border = bd
        ws.row_dimensions[r].height = 20

    output = io.BytesIO()
    wb.save(output); output.seek(0)
    fname = f'amazon_image_urls_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
    return send_file(output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True, download_name=fname)

@app.route('/health')
def health():
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_ENV') == 'development')
