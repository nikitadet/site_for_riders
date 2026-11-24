// ================= НАСТРОЙКИ =================
const SOILS = {
    loam_light:  { label: 'дерново-слабосуглинистый',  dryingBaseHours: 24, humidityWarn: 80 },
    loam_medium: { label: 'дерново-среднесуглинистый', dryingBaseHours: 36, humidityWarn: 85 }
};

// ================= ЗАГРУЗКА ДАННЫХ (ключа здесь нет!) =================
async function fetchWeather(spotId = 'filevsky') {
    toggle('loading', true);
    toggle('errorBox', false);
    try {
        const response = await fetch('data/weather.json');
        if (!response.ok) throw new Error('Данные ещё не сгенерированы. Запусти workflow в Actions.');
        const db = await response.json();
        const spot = db.spots[spotId];
        if (!spot) throw new Error('Спот не найден: ' + spotId);
        render(spot.weather, spot.name, db.updated_at);
    } catch (e) {
        showError(e.message);
    } finally {
        toggle('loading', false);
    }
}

// ================= ЛОГИКА "ИНДЕКСА ПРИГОДНОСТИ" =================
// Прокси-модель на основе ГОСТ 25100-2020: API не знает влажность грунта,
// поэтому оцениваем её по осадкам, влажности воздуха, температуре и ветру.
function assessTrail(w, soil) {
    const temp = w.main.temp;
    const hum = w.main.humidity;
    const rain1 = w.rain?.['1h'] ?? 0;
    const rain3 = w.rain?.['3h'] ?? 0;
    const snow1 = w.snow?.['1h'] ?? 0;
    const desc = (w.weather?.[0]?.description || '').toLowerCase();

    const rainingNow = rain1 > 0 || /дожд|ливень|морось|гроза/.test(desc);
    const snowingNow = snow1 > 0 || /снег|метель/.test(desc);
    const recentRain = rain3 > 0;
    const dryHours = estimateDryingHours(w, soil);

    if (rainingNow) {
        return { level: 'red', title: '🔴 Кататься нельзя',
            advice: 'Идёт дождь. Суглинок переходит в пластичное состояние: скользко, колёса оставляют колею, грунт липнет к шинам. Катание сейчас портит трассу.',
            drying: dryHours };
    }
    if (snowingNow) {
        return { level: 'red', title: '🔴 Кататься нельзя',
            advice: 'Снег на грунте — сцепление минимальное, тормозной путь непредсказуем.', drying: null };
    }
    if (temp <= 0 && hum >= 75) {
        return { level: 'red', title: '🔴 Опасно: ледяная корка',
            advice: 'Мороз при высокой влажности — влага в порах грунта замерзает. Сцепление как на льду.', drying: null };
    }
    if (recentRain) {
        return { level: 'yellow', title: '🟡 Грунт ещё сырой',
            advice: `Дождь был в последние 3 часа (${rain3} мм). ${soil.label} грунт удерживает воду — верхний слой может подсохнуть, но внутри трасса сырая. Подожди высыхания.`,
            drying: dryHours };
    }
    if (hum >= soil.humidityWarn) {
        return { level: 'yellow', title: '🟡 Будь осторожен',
            advice: `Влажность воздуха ${hum}% — суглинок медленно отдаёт влагу, в тени и низинах грунт может быть сырым. Проверяй покрытие перед трюками.`,
            drying: dryHours };
    }
    if (temp <= 2 && hum >= 70) {
        return { level: 'yellow', title: '🟡 Холодно и сыро',
            advice: 'Низкая температура замедляет испарение — грунт может оставаться влажным дольше обычного.', drying: dryHours };
    }
    return { level: 'green', title: '🟢 Отличные условия!',
        advice: 'Осадков нет, влажность умеренная — суглинок в полутвёрдом/тугопластичном состоянии. То самое "hero dirt": максимальное сцепление и накат.', drying: null };
}

// Оценка времени высыхания суглинка после дождя (часы).
function estimateDryingHours(w, soil) {
    const temp = w.main.temp;
    const wind = w.wind?.speed ?? 0;
    const clouds = w.clouds?.all ?? 50;
    const hum = w.main.humidity;

    let factor = 1;
    if (temp >= 25)      factor *= 0.5;
    else if (temp >= 15) factor *= 0.7;
    else if (temp < 5)   factor *= 1.6;

    if (wind >= 7)      factor *= 0.6;
    else if (wind >= 4) factor *= 0.8;

    if (clouds <= 25)   factor *= 0.75;
    else if (clouds >= 80) factor *= 1.2;

    if (hum >= 85) factor *= 1.3;

    return Math.max(2, Math.round(soil.dryingBaseHours * factor));
}

// ================= ОТРИСОВКА =================
function render(data, placeName, updatedAt) {
    const soil = SOILS[document.getElementById('soilSelect').value];
    const status = assessTrail(data, soil);

    const card = document.getElementById('statusCard');
    card.className = 'card status-card level-' + status.level;
    document.getElementById('statusTitle').textContent = status.title;
    document.getElementById('statusAdvice').textContent = status.advice;
    document.getElementById('dryingInfo').textContent = status.drying
        ? `⏱️ Ориентировочное время высыхания (${soil.label} грунт): ~${status.drying} ч`
        : '';
    toggle('statusCard', true);

    const icon = data.weather?.[0]?.icon;
    document.getElementById('weatherHeader').innerHTML = `
        ${icon ? `<img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="иконка погоды">` : ''}
        <div>
            <div class="big-temp">${Math.round(data.main.temp)}°C</div>
            <div class="place">${placeName} · ${data.weather?.[0]?.description ?? ''}</div>
            <div class="place">🕒 Данные от: ${new Date(updatedAt).toLocaleString('ru-RU')}</div>
        </div>`;

    const items = [
        ['Локация', `${placeName} (станция OWM: ${data.name})`],
        ['Страна', data.sys?.country ?? 'н/д'],
        ['Время замера', formatTime(data.dt, data.timezone)],
        ['Температура', `${Math.round(data.main.temp)} °C`],
        ['Ощущается как', `${Math.round(data.main.feels_like)} °C`],
        ['Мин / макс за период', `${Math.round(data.main.temp_min)} / ${Math.round(data.main.temp_max)} °C`],
        ['Влажность воздуха', `${data.main.humidity} %`],
        ['Давление', `${data.main.pressure} гПа (${Math.round(data.main.pressure * 0.750062)} мм рт. ст.)`],
        ['Видимость', data.visibility != null ? `${(data.visibility / 1000).toFixed(1)} км` : 'н/д'],
        ['Ветер', `${data.wind?.speed ?? 0} м/с, ${windDir(data.wind?.deg ?? 0)}`],
        ['Порывы ветра', data.wind?.gust != null ? `${data.wind.gust} м/с` : 'нет данных'],
        ['Облачность', `${data.clouds?.all ?? 'н/д'} %`],
        ['Дождь за 1 ч', data.rain?.['1h'] ? `${data.rain['1h']} мм` : 'нет'],
        ['Снег за 1 ч', data.snow?.['1h'] ? `${data.snow['1h']} мм` : 'нет'],
        ['Восход', formatTime(data.sys?.sunrise, data.timezone)],
        ['Закат', formatTime(data.sys?.sunset, data.timezone)]
    ];
    if (data.main.sea_level != null) items.push(['Давление (ур. моря)', `${data.main.sea_level} гПа`]);
    if (data.main.grnd_level != null) items.push(['Давление (ур. земли)', `${data.main.grnd_level} гПа`]);

    document.getElementById('dataGrid').innerHTML = items.map(([label, value]) => `
        <div class="data-item">
            <div class="label">${label}</div>
            <div class="value">${value}</div>
        </div>`).join('');

    document.getElementById('rawJson').textContent = JSON.stringify(data, null, 2);
    toggle('dataCard', true);
}

// ================= ВСПОМОГАТЕЛЬНЫЕ =================
function formatTime(unix, tzOffset) {
    if (unix == null) return 'н/д';
    return new Date((unix + tzOffset) * 1000)
        .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

function windDir(deg) {
    const dirs = ['С', 'ССВ', 'СВ', 'ВСВ', 'В', 'ВЮВ', 'ЮВ', 'ЮЮВ',
                  'Ю', 'ЮЮЗ', 'ЮЗ', 'ЗЮЗ', 'З', 'ЗСЗ', 'СЗ', 'ССЗ'];
    return dirs[Math.round(deg / 22.5) % 16];
}

function toggle(id, show) { document.getElementById(id).classList.toggle('hidden', !show); }
function showError(msg) {
    const box = document.getElementById('errorBox');
    box.textContent = '⚠️ ' + msg;
    toggle('errorBox', true);
}

// ================= ОБРАБОТЧИКИ =================
document.getElementById('btnPark').addEventListener('click', () => fetchWeather('filevsky'));
document.getElementById('soilSelect').addEventListener('change', () => fetchWeather('filevsky'));

// Показываем данные сразу при открытии страницы
fetchWeather();
