// sheetsService.js
const { google } = require('googleapis');
const path = require('path');
const https = require('https');
require('dotenv').config();

class SheetsService {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID;
    this.initialized = false;
    console.log('SheetsService создан, spreadsheetId:', this.spreadsheetId);
  }

  async init() {
    if (this.initialized) return;
    
    console.log('Инициализация Google Sheets...');
    
    try {
      // Проверяем наличие файла с учетными данными
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './credentials/service-account.json';
      console.log('Путь к учетным данным:', credentialsPath);
      
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const authClient = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      
      console.log('✅ Google Sheets API инициализирован');
      this.initialized = true;
    } catch (error) {
      console.error('❌ Ошибка инициализации Google Sheets:', error.message);
      console.error('Stack:', error.stack);
      throw error;
    }
  }

  async getVacancies() {
    try {
      if (!this.initialized) await this.init();
      
      console.log('Получаем вакансии из таблицы...');
      
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Проекты!B:B', // Столбец B = Вакансия
      });

      const rows = response.data.values || [];
      console.log('Получено строк:', rows.length);
      
      // Получаем все вакансии (пропускаем заголовок)
      const vacancies = rows.slice(1)
        .map(row => row[0])
        .filter(vacancy => vacancy && vacancy.trim() !== '');
      
      // Удаляем дубликаты
      const uniqueVacancies = [...new Set(vacancies)];
      
      console.log(`📋 Найдено уникальных вакансий: ${uniqueVacancies.length}`);
      return uniqueVacancies;
    } catch (error) {
      console.error('❌ Ошибка получения вакансий:', error.message);
      console.error('Stack:', error.stack);
      // Возвращаем заглушку при ошибке
      return ['Кассир', 'Уборщик', 'Повар', 'Менеджер'];
    }
  }

  async getDataForVacancy(vacancyName) {
    try {
      if (!this.initialized) await this.init();
      
      console.log(`Получаем данные для вакансии: ${vacancyName}`);
      
      // Получаем все данные
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Проекты!A:J', // Все столбцы от A до J
      });

      const rows = response.data.values || [];
      console.log('Получено строк данных:', rows.length);
      
      if (rows.length < 2) {
        console.log('Только заголовок, данных нет');
        return [];
      }
      
      const headers = rows[0];
      console.log('Заголовки:', headers);
      
      const dataRows = rows.slice(1);
      
      // Находим индекс столбца с вакансиями
      const vacancyIndex = headers.findIndex(h => 
        h.toLowerCase().includes('ваканс')
      );
      
      if (vacancyIndex === -1) {
        console.error('Не найден столбец с вакансиями');
        return [];
      }
      
      // Фильтруем строки по вакансии
      const filteredRows = dataRows.filter(row => 
        row[vacancyIndex] && row[vacancyIndex].toLowerCase() === vacancyName.toLowerCase()
      );
      
      console.log(`Найдено строк для вакансии "${vacancyName}": ${filteredRows.length}`);
      
      // Преобразуем в удобный формат
      const shops = filteredRows.map(row => {
        const shop = {};
        headers.forEach((header, index) => {
          shop[header.toLowerCase()] = row[index] || '';
        });
        
        // Парсим координаты
        if (shop['координаты']) {
          const coords = shop['координаты'].split(',').map(coord => parseFloat(coord.trim()));
          if (coords.length >= 2) {
            shop.coordinates = { latitude: coords[0], longitude: coords[1] };
          } else {
            shop.coordinates = { latitude: 0, longitude: 0 };
          }
        } else {
          shop.coordinates = { latitude: 0, longitude: 0 };
        }
        
        return shop;
      });
      
      console.log(`🏪 Найдено магазинов для вакансии "${vacancyName}": ${shops.length}`);
      return shops;
    } catch (error) {
      console.error(`❌ Ошибка получения данных для вакансии "${vacancyName}":`, error.message);
      console.error('Stack:', error.stack);
      return [];
    }
  }

  async testConnection() {
    try {
      console.log('Тестируем подключение к Google Sheets...');
      console.log('Spreadsheet ID:', this.spreadsheetId);
      
      if (!this.initialized) await this.init();
      
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });
      
      console.log(`📊 Подключено к таблице: "${response.data.properties.title}"`);
      return true;
    } catch (error) {
      console.error('❌ Тест подключения не пройден:', error.message);
      console.error('Stack:', error.stack);
      return false;
    }
  }

  // Геокодирование адреса в координаты через Yandex Geocoding v1 (с fallback на OSM)
  async geocodeAddress(address) {
    try {
      const apiKey = process.env.YANDEX_GEOCODING_API_KEY || process.env.YANDEX_API_KEY || '';
      const variants = this.buildAddressVariants(address);
      for (const q of variants) {
        const ya = await this.yandexGeocode(q, apiKey);
        if (ya) return ya;
      }
      const o = await this.osmGeocode(variants[0]);
      return o;
    } catch (error) {
      console.error(`❌ Ошибка геокодирования адреса "${address}":`, error.message);
      return null;
    }
  }

  normalizeAddress(address) {
    const parts = address.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const city = parts[0];
      let street = parts[1];
      const house = parts.slice(2).join(' ');
      const tokens = ['улица', 'ул.', 'проспект', 'пр-т', 'шоссе', 'ш.', 'бульвар', 'бул.', 'проезд', 'пер.', 'переулок', 'наб.', 'площадь', 'пл.'];
      const hasType = tokens.some(t => street.toLowerCase().includes(t));
      if (!hasType) {
        street = `улица ${street}`;
      }
      return `Россия, ${city}, ${street}, ${house}`;
    }
    return `Россия, ${address}`;
  }

  buildAddressVariants(address) {
    const original = address.trim();
    const normalized = this.normalizeAddress(original);
    const parts = original.split(',').map(p => p.trim()).filter(Boolean);
    const variantCityStreet = parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : original;
    const normalizedCityStreet = this.normalizeAddress(variantCityStreet);
    const variantCityOnly = parts.length >= 1 ? parts[0] : original;
    const normalizedCityOnly = this.normalizeAddress(variantCityOnly);
    const variants = [
      original,
      normalized,
      normalizedCityStreet,
      normalizedCityOnly,
      `Россия, ${original}`
    ];
    const seen = new Set();
    return variants.filter(v => {
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async yandexGeocode(query, apiKey) {
    const url = `https://geocode-maps.yandex.ru/v1/?format=json${apiKey ? `&apikey=${apiKey}` : ''}&geocode=${encodeURIComponent(query)}`;
    return new Promise((resolve) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            const coords = this.parseYandexCoordinates(result);
            if (coords) return resolve(coords);
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => {
        resolve(null);
      });
    });
  }

  parseYandexCoordinates(result) {
    if (result && Array.isArray(result.features) && result.features.length > 0) {
      const f = result.features[0];
      if (f && f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2) {
        const [lon, lat] = f.geometry.coordinates;
        return { latitude: parseFloat(lat), longitude: parseFloat(lon) };
      }
    }
    const members = result && result.response && result.response.GeoObjectCollection && result.response.GeoObjectCollection.featureMember;
    if (Array.isArray(members) && members.length > 0) {
      const geoObject = members[0].GeoObject;
      const pos = geoObject && geoObject.Point && geoObject.Point.pos;
      if (pos) {
        const [lonStr, latStr] = pos.split(' ').map(s => s.trim());
        return { latitude: parseFloat(latStr), longitude: parseFloat(lonStr) };
      }
    }
    return null;
  }

  async osmGeocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`;
    return new Promise((resolve) => {
      https.get(url, { headers: { 'User-Agent': 'vacancy-bot/1.0' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (Array.isArray(result) && result.length > 0) {
              const item = result[0];
              const coordinates = {
                latitude: parseFloat(item.lat),
                longitude: parseFloat(item.lon)
              };
              resolve(coordinates);
              return;
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      }).on('error', () => {
        resolve(null);
      });
    });
  }

  // Расчет расстояния между двумя точками (формула Haversine) в километрах
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Радиус Земли в километрах
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return distance;
  }

  // Преобразование градусов в радианы
  toRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

// Создаем и экспортируем экземпляр
const sheetsService = new SheetsService();

// Экспортируем для использования в других файлах
module.exports = sheetsService;
