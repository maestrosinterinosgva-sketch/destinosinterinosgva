"""
parse_puestos.py
Extractor de alta precisión para los listados oficiales de puestos ofertados (PDF)
de la Conselleria de Educación de la Generalitat Valenciana.
Cruza cada plaza con las coordenadas GPS oficiales de los centros de la CV.
"""
import sys
import os
import re
import json
import pymupdf

def load_geo_database(base_dir="."):
    centros_path = os.path.join(base_dir, "data", "centros_geo.json")
    municipios_path = os.path.join(base_dir, "data", "municipios_coords.json")
    jornadas_path = os.path.join(base_dir, "data", "centros_jornadas.json")
    
    centros_geo = {}
    municipios_geo = {}
    centros_jornadas = {}
    
    if os.path.exists(centros_path):
        try:
            with open(centros_path, "r", encoding="utf-8") as f:
                centros_geo = json.load(f)
        except Exception as e:
            print(f"[!] Aviso al cargar centros_geo: {e}")
            
    if os.path.exists(municipios_path):
        try:
            with open(municipios_path, "r", encoding="utf-8") as f:
                mun_list = json.load(f)
                for m in mun_list:
                    municipios_geo[m["nombre"].upper()] = m
        except Exception as e:
            print(f"[!] Aviso al cargar municipios_coords: {e}")

    if os.path.exists(jornadas_path):
        try:
            with open(jornadas_path, "r", encoding="utf-8") as f:
                centros_jornadas = json.load(f)
        except Exception as e:
            print(f"[!] Aviso al cargar centros_jornadas: {e}")

    return centros_geo, municipios_geo, centros_jornadas

def parse_puestos_pdf(pdf_path, base_dir="."):
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"No existe el archivo {pdf_path}")

    centros_geo, municipios_geo, centros_jornadas = load_geo_database(base_dir)

    doc = pymupdf.open(pdf_path)
    total_pages = len(doc)
    print(f"[*] Abriendo '{pdf_path}' ({total_pages} páginas)...")

    # Extraer fecha de adjudicación de la primera página
    fecha_adjudicacion = "Fecha oficial"
    fecha_publicacion = ""
    try:
        p0_text = doc[0].get_text("text")
        m_fecha = re.search(r'ADJUDICACI[ÓO]N DE PERSONAL DOCENTE INTERINO D[ÍI]A\s*(\d{2}/\d{2}/\d{4})', p0_text, re.IGNORECASE)
        if m_fecha:
            fecha_adjudicacion = m_fecha.group(1)
        m_pub = re.search(r'(\d{2}/\d{2}/\d{4})\s*\n\s*Avgda\.Campanar', p0_text)
        if m_pub:
            fecha_publicacion = m_pub.group(1)
        elif not fecha_publicacion:
            m_alt = re.findall(r'(\d{2}/\d{2}/\d{4})', p0_text)
            if len(m_alt) > 1:
                fecha_publicacion = m_alt[0]
    except Exception as e:
        print(f"[!] Error al extraer fecha: {e}")

    current_cuerpo = ""
    current_especialidad = ""
    current_provincia = ""

    plazas = []
    re_num = re.compile(r'^\d+$')
    re_centro = re.compile(r'^(.+?)\s*-\s*(\d{8})\s*-\s*(.+)$')
    re_shared = re.compile(r'(\d{8}):\s*(.+?)\s*\((.+?)\)\s*([0-9.,]+)\s*hores?\s*(.*)', re.IGNORECASE)

    for pno in range(total_pages):
        page = doc[pno]
        full_text = page.get_text("text")

        # Detectar CUERPO
        m_c = re.search(r'CUERPO/COS:\s*(.*?)(?=\nESPECIALIDAD|\nPROVINCIA|\nLOCALIDAD|$)', full_text)
        if m_c:
            val = m_c.group(1).strip().replace('\n', ' ')
            if val:
                current_cuerpo = val

        # Detectar ESPECIALIDAD
        m_e = re.search(r'ESPECIALIDAD/ESPECIALITAT:\s*(.*?)(?=\nPROVINCIA|\nLOCALIDAD|$)', full_text)
        if m_e:
            val = m_e.group(1).strip().replace('\n', ' ')
            if val:
                current_especialidad = val

        # Extraer palabras ordenadas
        words = page.get_text("words")
        # Filtrar cabecera y pie
        content_words = [w for w in words if 165 <= w[1] <= 555]

        # Agrupación adaptativa por proximidad vertical (evita partir líneas)
        lines = []
        for w in sorted(content_words, key=lambda x: (x[1], x[0])):
            assigned = False
            for line in lines:
                avg_y = sum(item[1] for item in line) / len(line)
                if abs(w[1] - avg_y) <= 3.5:
                    line.append(w)
                    assigned = True
                    break
            if not assigned:
                lines.append([w])

        for line in lines:
            line.sort(key=lambda w: w[0])
        lines.sort(key=lambda line: line[0][1])

        for line in lines:
            line_text = " ".join([w[4] for w in line]).strip()

            # Cambio de provincia
            if "PROVINCIA/PROVINCIA:" in line_text or line_text in ["Alacant", "Castelló", "València"]:
                for prov in ["Alacant", "Castelló", "València"]:
                    if prov.lower() in line_text.lower():
                        current_provincia = prov
                continue

            # Saltar cabeceras de tabla
            if "LOCALIDAD / LOCALITAT" in line_text or "TIPUS/TIPO" in line_text:
                continue

            # Línea de centro compartido (itinerancia)
            m_sh = re_shared.search(line_text)
            if m_sh:
                if plazas:
                    sh_cod = m_sh.group(1)
                    sh_nom = m_sh.group(2).strip()
                    sh_loc = m_sh.group(3).strip()
                    sh_horas = m_sh.group(4).replace(',', '.')
                    sh_mat = m_sh.group(5).strip()

                    sh_lat = None
                    sh_lng = None
                    if sh_cod in centros_geo:
                        sh_lat = centros_geo[sh_cod]["lat"]
                        sh_lng = centros_geo[sh_cod]["lng"]
                    elif sh_loc.upper() in municipios_geo:
                        sh_lat = municipios_geo[sh_loc.upper()]["lat"]
                        sh_lng = municipios_geo[sh_loc.upper()]["lng"]

                    sh_entry = {
                        "codigo_centro": sh_cod,
                        "nombre_centro": sh_nom,
                        "localidad": sh_loc,
                        "horas": sh_horas,
                        "materia": sh_mat,
                        "lat": sh_lat,
                        "lng": sh_lng
                    }
                    if "centros_compartidos" not in plazas[-1]:
                        plazas[-1]["centros_compartidos"] = []
                    plazas[-1]["centros_compartidos"].append(sh_entry)
                continue

            # Fila de plaza principal (comienza por el número de orden en x < 45)
            first_w = line[0]
            if first_w[0] < 45 and re_num.match(first_w[4]):
                num_orden = int(first_w[4])

                centro_words = []
                lloc = ""
                horas = ""
                req_ling = ""
                itinerante = "NO"
                observ = []
                tipo_words = []

                for w in line[1:]:
                    x_mid = (w[0] + w[2]) / 2.0
                    txt = w[4]

                    if x_mid < 288:
                        centro_words.append(txt)
                    elif 288 <= x_mid < 330 and re.match(r'^\d{5,7}$', txt):
                        lloc = txt
                    elif 330 <= x_mid < 365 and re.match(r'^[0-9.,]+$', txt):
                        horas = txt.replace(',', '.')
                    elif 365 <= x_mid < 445 and any(tag in txt for tag in ["ING", "VAL", "FRA", "ALE", "B2", "C1", "C2"]):
                        req_ling = (req_ling + " " + txt).strip()
                    elif 445 <= x_mid < 485 and txt in ["SI", "NO"]:
                        itinerante = txt
                    elif x_mid >= 615:
                        tipo_words.append(txt)
                    else:
                        if 485 <= x_mid < 615:
                            observ.append(txt)
                        elif x_mid >= 615:
                            tipo_words.append(txt)
                        else:
                            observ.append(txt)

                tipo_str = " ".join(tipo_words).strip()
                if "VACANTE" in tipo_str:
                    tipo = "VACANTE"
                elif "INDETERMINADA" in tipo_str:
                    tipo = "SUSTITUCIÓN INDETERMINADA"
                elif "DETERMINADA" in tipo_str:
                    tipo = "SUSTITUCIÓN DETERMINADA"
                else:
                    tipo = tipo_str or "DESCONOCIDO"

                centro_str = " ".join(centro_words).strip()
                m_c = re_centro.match(centro_str)
                if m_c:
                    localidad = m_c.group(1).strip()
                    cod_centro = m_c.group(2).strip()
                    nom_centro = m_c.group(3).strip()
                else:
                    cod_match = re.search(r'(\d{8})', centro_str)
                    if cod_match:
                        cod_centro = cod_match.group(1)
                        parts = centro_str.split(cod_centro)
                        localidad = parts[0].strip(' -')
                        nom_centro = parts[1].strip(' -')
                    else:
                        localidad = centro_str
                        cod_centro = ""
                        nom_centro = ""

                observ_str = " ".join(observ).strip()
                for t in ["SUSTITUCIÓN INDETERMINADA", "SUSTITUCIÓN DETERMINADA", "VACANTE"]:
                    observ_str = observ_str.replace(t, "").strip()

                # Separar código y nombre de la especialidad
                cod_esp = ""
                nom_esp = current_especialidad
                m_esp_parts = re.match(r'^([A-Z0-9]+)\s*-\s*(.+)$', current_especialidad)
                if m_esp_parts:
                    cod_esp = m_esp_parts.group(1).strip()
                    nom_esp = m_esp_parts.group(2).strip()

                # Geocodificación del centro
                lat = None
                lng = None
                direccion = ""
                cp = ""
                comarca = ""

                if cod_centro in centros_geo:
                    c_info = centros_geo[cod_centro]
                    lat = c_info["lat"]
                    lng = c_info["lng"]
                    direccion = c_info["direccion"]
                    cp = c_info["cp"]
                    comarca = c_info["comarca"]
                else:
                    clean_loc = localidad.split('-')[0].strip().upper()
                    if clean_loc in municipios_geo:
                        m_info = municipios_geo[clean_loc]
                        lat = m_info["lat"]
                        lng = m_info["lng"]
                    else:
                        for m_name, m_info in municipios_geo.items():
                            if m_name in clean_loc or clean_loc in m_name:
                                lat = m_info["lat"]
                                lng = m_info["lng"]
                                break

                es_completa = True if not horas else False
                horas_num = float(horas) if horas else 25.0

                j_info = centros_jornadas.get(cod_centro, {})
                j_tipo = j_info.get("tipo", "PARTIDA")
                j_desc = j_info.get("descripcion", "Jornada Partida (9:00 a 17:00)")
                j_corta = j_info.get("corta", "Partida 9h-17h")

                plazas.append({
                    "numero": num_orden,
                    "cuerpo": current_cuerpo,
                    "especialidad_completa": current_especialidad,
                    "codigo_especialidad": cod_esp,
                    "especialidad": nom_esp,
                    "provincia": current_provincia,
                    "localidad": localidad,
                    "codigo_centro": cod_centro,
                    "nombre_centro": nom_centro,
                    "jornada": j_tipo,
                    "jornada_desc": j_desc,
                    "jornada_corta": j_corta,
                    "direccion": direccion,
                    "cp": cp,
                    "comarca": comarca,
                    "lat": lat,
                    "lng": lng,
                    "lloc": lloc,
                    "horas": horas if horas else "Completa",
                    "horas_num": horas_num,
                    "es_completa": es_completa,
                    "req_ling": req_ling,
                    "itinerante": itinerante,
                    "observaciones": observ_str,
                    "tipo": tipo,
                    "centros_compartidos": []
                })
            else:
                # Línea de continuación de observaciones
                if plazas and line_text and not line_text.startswith("Pàg") and not line_text.startswith("PROVINCIA"):
                    if any(w[0] > 450 for w in line):
                        extra_obs = " ".join([w[4] for w in line if w[0] > 450]).strip()
                        if extra_obs:
                            plazas[-1]["observaciones"] = (plazas[-1]["observaciones"] + " " + extra_obs).strip()

    print(f"[OK] Total plazas extraídas: {len(plazas)}")

    # Calcular estadísticas completas
    stats = {
        "fecha_adjudicacion": fecha_adjudicacion,
        "fecha_publicacion": fecha_publicacion,
        "total_plazas": len(plazas),
        "total_maestros": sum(1 for p in plazas if "MAESTRO" in p["cuerpo"].upper()),
        "total_secundaria": sum(1 for p in plazas if "SECUNDARIA" in p["cuerpo"].upper()),
        "total_vacantes": sum(1 for p in plazas if p["tipo"] == "VACANTE"),
        "total_sustituciones_indet": sum(1 for p in plazas if p["tipo"] == "SUSTITUCIÓN INDETERMINADA"),
        "total_sustituciones_det": sum(1 for p in plazas if p["tipo"] == "SUSTITUCIÓN DETERMINADA"),
        "total_itinerantes": sum(1 for p in plazas if p["itinerante"] == "SI"),
        "total_jornada_parcial": sum(1 for p in plazas if not p["es_completa"]),
        "especialidades_maestros": {}
    }

    for p in plazas:
        if "MAESTRO" in p["cuerpo"].upper():
            esp = p["especialidad"]
            stats["especialidades_maestros"][esp] = stats["especialidades_maestros"].get(esp, 0) + 1

    # Guardar datasets
    out_dir = os.path.join(base_dir, "data")
    os.makedirs(out_dir, exist_ok=True)

    json_path = os.path.join(out_dir, "puestos_data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(plazas, f, ensure_ascii=False, indent=2)

    js_path = os.path.join(out_dir, "puestos_data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.PUESTOS_DATA = " + json.dumps(plazas, ensure_ascii=False) + ";\n")

    stats_json_path = os.path.join(out_dir, "stats_summary.json")
    with open(stats_json_path, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

    stats_js_path = os.path.join(out_dir, "stats_summary.js")
    with open(stats_js_path, "w", encoding="utf-8") as f:
        f.write("window.STATS_SUMMARY = " + json.dumps(stats, ensure_ascii=False) + ";\n")

    print(f"[OK] Archivos de datos generados en '{out_dir}':")
    print(f"     - {json_path} ({os.path.getsize(json_path)/1024:.1f} KB)")
    print(f"     - {js_path} ({os.path.getsize(js_path)/1024:.1f} KB)")
    print(f"     - {stats_json_path}")
    print(f"     - {stats_js_path}")

    return plazas, stats

if __name__ == "__main__":
    pdf_target = "260908_pue_prov.pdf"
    if len(sys.argv) > 1:
        pdf_target = sys.argv[1]
    parse_puestos_pdf(pdf_target)
