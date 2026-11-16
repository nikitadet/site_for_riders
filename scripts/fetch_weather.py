import json, os, urllib.request, datetime

KEY = os.environ["OWM_KEY"] 

SPOTS = [
    {"id": "filevsky", "name": "Филёвский парк", "lat": 55.7400, "lon": 37.4619},
    # добавлять новые споты сюда
]

result = {
    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "spots": {}
}

for s in SPOTS:
    url = (f"https://api.openweathermap.org/data/2.5/weather"
           f"?lat={s['lat']}&lon={s['lon']}&appid={KEY}&units=metric&lang=ru")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            result["spots"][s["id"]] = {"name": s["name"], "weather": json.load(r)}
    except Exception as e:
        print(f"Ошибка для {s['name']}: {e}")

os.makedirs("data", exist_ok=True)
with open("data/weather.json", "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False)
print("Готово:", list(result["spots"].keys()))
