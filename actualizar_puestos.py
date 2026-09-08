"""
actualizar_puestos.py
Script maestro para actualizar la aplicación de destinos con un nuevo PDF de puestos ofertados.
Puede recibir un archivo local o una URL directa de Conselleria.
"""
import sys
import os
import glob
import zipfile
import urllib.request
from parse_puestos import parse_puestos_pdf

def get_latest_puestos_pdf(current_dir="."):
    pdfs = glob.glob(os.path.join(current_dir, "*.pdf"))
    pue_pdfs = [p for p in pdfs if "pue_prov" in os.path.basename(p).lower() or "ofert" in os.path.basename(p).lower()]
    if not pue_pdfs:
        # fallback to any pdf that isn't adjudicaciones o interinos
        pue_pdfs = [p for p in pdfs if "ini_2026" not in os.path.basename(p).lower()]
    if not pue_pdfs:
        return None
    pue_pdfs.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return os.path.basename(pue_pdfs[0])

def download_pdf_if_url(target):
    if not target or not (target.startswith("http://") or target.startswith("https://")):
        return target
    print(f"[*] Descargando nuevo PDF de puestos desde URL:\n    {target}")
    local_filename = "puestos_descargados_auto.pdf"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    req = urllib.request.Request(target, headers=headers)
    with urllib.request.urlopen(req, timeout=45) as response, open(local_filename, 'wb') as out_file:
        out_file.write(response.read())
    print(f"[OK] Archivo descargado con éxito: {local_filename}")
    return local_filename

def update_zip_package(output_zip="destinos_web.zip"):
    files_to_pack = [
        'index.html',
        'manifest.json',
        'css/style.css',
        'js/app.js',
        'data/puestos_data.js',
        'data/puestos_data.json',
        'data/stats_summary.js',
        'data/stats_summary.json',
        'data/municipios_coords.js',
        'data/municipios_coords.json',
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/apple-touch-icon.png'
    ]
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for rel_path in files_to_pack:
            if os.path.exists(rel_path):
                z.write(rel_path, rel_path)
    print(f"[OK] Paquete web para publicar actualizado: {output_zip} ({os.path.getsize(output_zip)/1024/1024:.2f} MB)")

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(base_dir)

    target_pdf = None
    if len(sys.argv) > 1:
        target_pdf = sys.argv[1].strip().strip('"').strip("'")
        if target_pdf.startswith("http://") or target_pdf.startswith("https://"):
            try:
                target_pdf = download_pdf_if_url(target_pdf)
            except Exception as e:
                print(f"[-] Error al descargar el PDF desde la URL: {e}")
                return
    else:
        target_pdf = get_latest_puestos_pdf(base_dir)

    if not target_pdf or not os.path.exists(target_pdf):
        print("[-] Error: No se ha encontrado ningún archivo PDF de puestos ofertados en la carpeta.")
        return

    print("=" * 64)
    print(" ACTUALIZACIÓN DE PUESTOS OFERTADOS - CONSELLERIA GVA")
    print("=" * 64)
    print(f" Archivo PDF objetivo: {target_pdf}")

    plazas, stats = parse_puestos_pdf(target_pdf, base_dir)
    update_zip_package()

    print("\n" + "=" * 64)
    print(" [OK] ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO!")
    print(f"      Fecha Adjudicación: {stats['fecha_adjudicacion']}")
    print(f"      Total Plazas:       {stats['total_plazas']}")
    print(f"      Cuerpo Maestros:    {stats['total_maestros']}")
    print("=" * 64)

if __name__ == "__main__":
    main()
