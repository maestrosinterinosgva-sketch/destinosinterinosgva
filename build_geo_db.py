import csv
import json
import os
import re

def build_geo_database():
    os.makedirs("data", exist_ok=True)
    
    centros_file = "data/centros_cv.csv"
    if not os.path.exists(centros_file):
        raise FileNotFoundError(f"No se encuentra {centros_file}")

    centros = {}
    municipios = {}

    with open(centros_file, "r", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            cod = row.get("codigo", "").strip()
            nom = row.get("denominacion", "").strip()
            loc = row.get("localidad", "").strip()
            prov = row.get("provincia", "").strip()
            dir_via = f"{row.get('tipo_via', '')} {row.get('direccion', '')} {row.get('numero', '')}".strip()
            cp = row.get("codigo_postal", "").strip()
            comarca = row.get("comarca", "").strip()
            
            lat_str = row.get("latitud", "").replace(",", ".").strip()
            lng_str = row.get("longitud", "").replace(",", ".").strip()

            try:
                lat = float(lat_str)
                lng = float(lng_str)
            except ValueError:
                continue

            # Standardize province
            if "ALICANTE" in prov.upper() or "ALACANT" in prov.upper():
                prov_clean = "Alicante"
            elif "CASTELL" in prov.upper():
                prov_clean = "Castellón"
            else:
                prov_clean = "Valencia"

            centros[cod] = {
                "codigo": cod,
                "denominacion": nom,
                "localidad": loc,
                "provincia": prov_clean,
                "direccion": dir_via,
                "cp": cp,
                "comarca": comarca,
                "lat": lat,
                "lng": lng
            }

            # Collect coordinates per municipality to calculate centroid
            loc_key = loc.upper()
            if loc_key not in municipios:
                municipios[loc_key] = {
                    "nombre": loc,
                    "provincia": prov_clean,
                    "lats": [],
                    "lngs": []
                }
            municipios[loc_key]["lats"].append(lat)
            municipios[loc_key]["lngs"].append(lng)

    # Calculate centroid per municipality
    municipios_clean = []
    for loc_key, m in municipios.items():
        avg_lat = sum(m["lats"]) / len(m["lats"])
        avg_lng = sum(m["lngs"]) / len(m["lngs"])
        municipios_clean.append({
            "nombre": m["nombre"],
            "provincia": m["provincia"],
            "lat": round(avg_lat, 6),
            "lng": round(avg_lng, 6),
            "total_centros": len(m["lats"])
        })

    municipios_clean.sort(key=lambda x: (x["provincia"], x["nombre"]))

    print(f"[OK] Centros procesados con coordenadas GPS: {len(centros)}")
    print(f"[OK] Municipios únicos con centroide calculado: {len(municipios_clean)}")

    # Save centros json
    with open("data/centros_geo.json", "w", encoding="utf-8") as f:
        json.dump(centros, f, ensure_ascii=False, indent=2)

    # Save municipios js and json
    with open("data/municipios_coords.json", "w", encoding="utf-8") as f:
        json.dump(municipios_clean, f, ensure_ascii=False, indent=2)

    with open("data/municipios_coords.js", "w", encoding="utf-8") as f:
        f.write("window.MUNICIPIOS_DATA = " + json.dumps(municipios_clean, ensure_ascii=False) + ";\n")

    print("[OK] Bases de datos geográficas generadas exitosamente en 'data/'.")

if __name__ == "__main__":
    build_geo_database()
