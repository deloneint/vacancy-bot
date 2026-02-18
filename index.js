const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const sheetsService = require('./sheetsService');

// Проверка токена
if (!process.env.BOT_TOKEN) {
  console.error('❌ ОШИБКА: BOT_TOKEN не найден');
  process.exit(1);
}

console.log('🚀 Запуск Telegram бота с Google Sheets...');

// Инициализация бота
const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// Хранилище состояний и данных
const userStates = {};
const userData = {};
const lastActivity = {};
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 минут

// Периодическая проверка активности (каждую минуту)
setInterval(() => {
  const now = Date.now();
  
  // Проверяем всех пользователей, у которых есть активное состояние
  for (const userId in userStates) {
    const userActivity = lastActivity[userId];
    
    // Если есть запись об активности и прошло больше времени таймаута
    if (userActivity && (now - userActivity.timestamp > INACTIVITY_TIMEOUT)) {
      console.log(`[TIMEOUT] Пользователь ${userId} неактивен более 30 минут. Сброс.`);
      
      // Отправляем сообщение (используем сохраненный chatId)
      if (userActivity.chatId) {
        bot.sendMessage(userActivity.chatId, 
          'Для нового поиска нажмите /start',
          { reply_markup: { remove_keyboard: true } }
        ).catch(err => console.error(`Ошибка отправки сообщения таймаута пользователю ${userId}:`, err.message));
      }
      
      // Сбрасываем состояние
      delete userStates[userId];
      delete userData[userId];
      delete lastActivity[userId];
    }
  }
}, 60 * 1000);

// Тестируем подключение к Google Sheets
sheetsService.testConnection().then(success => {
  if (success) {
    console.log('✅ Google Sheets подключен успешно');
  } else {
    console.log('⚠️  Google Sheets не подключен, используются тестовые данные');
  }
});

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  console.log(`[START] Пользователь ${userId}`);
  
  // Обновляем активность
  lastActivity[userId] = {
    timestamp: Date.now(),
    chatId: chatId
  };

  // Сбрасываем состояние
  userData[userId] = {};
  
  await bot.sendMessage(chatId, 
    '👋 Добро пожаловать в бот по подбору вакансий!',
    {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    }
  );

  await loadAndShowVacancies(bot, chatId, userId);
});

// Обработка контакта
bot.on('contact', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const contact = msg.contact;
  
  if (contact.user_id !== userId) {
    return bot.sendMessage(chatId, '❌ Пожалуйста, поделитесь своим номером.');
  }
  
  // Обновляем активность
  lastActivity[userId] = {
    timestamp: Date.now(),
    chatId: chatId
  };
  
  const state = userStates[userId];
  if (state !== 'REQUESTING_PHONE') {
     // Если пользователь отправил контакт не в том состоянии, можно либо игнорировать, либо обработать
     // В данном случае лучше продолжить, если мы ждем телефон
     console.log(`[PHONE] Контакт получен в состоянии ${state}, но мы примем его.`);
  }

  console.log(`[PHONE] Пользователь ${userId} предоставил номер: ${contact.phone_number}`);
  
    // Сохраняем данные
    userData[userId] = {
      ...userData[userId],
      phone: contact.phone_number
    };
    
    userStates[userId] = 'REQUESTING_AGE';
    await bot.sendMessage(chatId, 
      'Сколько вам полных лет?',
      { reply_markup: { remove_keyboard: true } }
    );
  });

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Обновляем активность
  lastActivity[userId] = {
    timestamp: Date.now(),
    chatId: chatId
  };
  
  // Пропускаем команды и контакты
  if (!text || text.startsWith('/') || msg.contact) return;
  
  const state = userStates[userId];
  const data = userData[userId] || {};
  
  console.log(`[MESSAGE] Пользователь ${userId}, состояние: ${state}, текст: "${text}"`);
  
  if (state === 'REQUESTING_FIO') {
    await handleFioInput(bot, chatId, userId, text);

  } else if (state === 'REQUESTING_PHONE') {
    // Проверка формата телефона: 79XXXXXXXXX
    const phoneRegex = /^7\d{10}$/;
    const cleanPhone = text.replace(/\D/g, ''); // Удаляем все нецифровые символы для проверки
    
    // Если пользователь ввел +7..., тоже считаем валидным, если цифр 11 и начинается с 7
    if (phoneRegex.test(cleanPhone) || (cleanPhone.length === 11 && cleanPhone.startsWith('7'))) {
       console.log(`[PHONE] Пользователь ${userId} ввел номер вручную: ${cleanPhone}`);
       
       userData[userId] = {
         ...data,
         phone: cleanPhone
       };
       
       userStates[userId] = 'REQUESTING_AGE';
       await bot.sendMessage(chatId, 
         'Сколько вам полных лет?',
         { reply_markup: { remove_keyboard: true } }
       );
    } else {
      await bot.sendMessage(chatId, 
        '❌ Неверный формат номера.\n' +
        'Пожалуйста, введите номер в формате 79XXXXXXXXX (например, 79001234567)\n' +
        'Или нажмите кнопку "Поделиться номером телефона".'
      );
    }
  
  } else if (state === 'REQUESTING_AGE') {
    const age = parseInt(text);
    if (isNaN(age) || age < 14 || age > 100) {
      await bot.sendMessage(chatId, '❌ Пожалуйста, введите корректный возраст цифрами (от 14 до 100).');
    } else {
      userData[userId] = {
        ...data,
        age: age
      };
      
      userStates[userId] = 'CONFIRMATION';
      await showConfirmation(bot, chatId, userId);
    }

  } else if (state === 'CHOOSING_VACANCY') {
    // Проверяем, что выбранная вакансия есть в списке
    const availableVacancies = data.availableVacancies || [];
    if (!availableVacancies.includes(text)) {
      return bot.sendMessage(chatId, '❌ Пожалуйста, выберите вакансию из списка.');
    }
    
    console.log(`[VACANCY] Выбрана вакансия: ${text}`);
    
    userStates[userId] = 'REQUESTING_LOCATION';
    userData[userId] = {
      ...data,
      selectedVacancy: text
    };
    
    await bot.sendMessage(chatId,
      `✅ Выбрана вакансия: ${text}\n\n` +
      'Отправьте ваше местоположение или введите адрес:\n' +
      'Город, Улица, Дом',
      {
        reply_markup: {
          keyboard: [
            [{ text: '📍 Отправить местоположение', request_location: true }],
            [{ text: '⬅️ Назад к выбору вакансии' }]
          ],
          resize_keyboard: true
        }
      }
    );
    
  } else if (state === 'REQUESTING_LOCATION') {
    if (text === '⬅️ Назад к выбору вакансии') {
      await loadAndShowVacancies(bot, chatId, userId);
    } else {
      console.log(`[LOCATION] Введен адрес: ${text}`);
      
      // Геокодируем адрес в координаты
      await bot.sendMessage(chatId, '📍 Определяю координаты по адресу...',
        { reply_markup: { remove_keyboard: true } }
      );
      
      const coordinates = await sheetsService.geocodeAddress(text);
      
      if (!coordinates) {
        return bot.sendMessage(chatId,
          '❌ Не удалось определить координаты по адресу.\n\n' +
          'Пожалуйста, проверьте формат адреса или используйте кнопку для отправки местоположения.',
          {
            reply_markup: {
              keyboard: [
                [{ text: '📍 Отправить местоположение', request_location: true }],
                [{ text: '⬅️ Назад к выбору вакансии' }]
              ],
              resize_keyboard: true
            }
          }
        );
      }
      
      userStates[userId] = 'SHOWING_SHOPS';
      userData[userId] = {
        ...data,
        userAddress: text,
        userLocation: coordinates,
        locationType: 'address'
      };
      
      // Загружаем магазины для выбранной вакансии
      await loadAndShowShops(bot, chatId, userId);
    }
    
  } else if (state === 'SHOWING_SHOPS') {
    await handleShopSelection(bot, chatId, userId, text);
    
  } else if (state === 'SHOWING_VACANCY_DETAILS') {
    await handleVacancyDetails(bot, chatId, userId, text);
    
  } else if (state === 'CONFIRMATION') {
    await handleConfirmation(bot, chatId, userId, text);
  }
});

// Обработка геолокации
bot.on('location', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  // Обновляем активность
  lastActivity[userId] = {
    timestamp: Date.now(),
    chatId: chatId
  };
  
  if (userStates[userId] === 'REQUESTING_LOCATION') {
    console.log(`[LOCATION] Получены координаты: ${msg.location.latitude}, ${msg.location.longitude}`);
    
    userStates[userId] = 'SHOWING_SHOPS';
    userData[userId] = {
      ...userData[userId],
      userLocation: {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude
      },
      locationType: 'coordinates'
    };
    
    // Загружаем магазины для выбранной вакансии
    await loadAndShowShops(bot, chatId, userId);
  }
});

// Функция загрузки и показа вакансий
async function loadAndShowVacancies(bot, chatId, userId) {
  const data = userData[userId];
  
  // Сохраняем данные (если это вызов не из возврата назад, а после телефона)
  userStates[userId] = 'CHOOSING_VACANCY';
  
  // Показываем сообщение о загрузке, если еще не показывали список
  if (!data.availableVacancies) {
      await bot.sendMessage(chatId, '⏳ Загружаем список вакансий...', 
        { reply_markup: { remove_keyboard: true } }
      );
  }
  
  // Получаем вакансии из Google Sheets
  let vacancies;
  try {
    // Если уже загружали, используем кэш, но лучше обновить если есть сомнения.
    // В данном случае лучше всегда свежие или из кэша. 
    // Для простоты загружаем заново, если нет в userData, или используем имеющиеся.
    // Но так как вакансии могут меняться, лучше подгружать.
    // Однако, чтобы не спамить API, можно проверить.
    // В старом коде всегда грузили. Оставим так.
    
    vacancies = await sheetsService.getVacancies();
    if (!vacancies || vacancies.length === 0) {
      vacancies = ['Кассир', 'Уборщик', 'Повар', 'Менеджер']; // Заглушка
    }
  } catch (error) {
    console.error('Ошибка загрузки вакансий:', error.message);
    vacancies = ['Кассир', 'Уборщик', 'Повар', 'Менеджер']; // Заглушка при ошибке
  }
  
  // Сохраняем список вакансий
  userData[userId].availableVacancies = vacancies;
  
  // Создаем клавиатуру с вакансиями
  const keyboard = [];
  for (let i = 0; i < vacancies.length; i += 2) {
    keyboard.push(vacancies.slice(i, i + 2));
  }
  
  await bot.sendMessage(chatId,
    'Выберите вакансию:',
    {
      reply_markup: {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
}

// Функция загрузки и показа магазинов
async function loadAndShowShops(bot, chatId, userId) {
  const data = userData[userId] || {};
  const selectedVacancy = data.selectedVacancy;
  const userLocation = data.userLocation;
  
  if (!selectedVacancy) {
    return bot.sendMessage(chatId, '❌ Ошибка: вакансия не выбрана.');
  }
  
  if (!userLocation || !userLocation.latitude || !userLocation.longitude) {
    return bot.sendMessage(chatId, '❌ Ошибка: местоположение не определено.');
  }
  
  await bot.sendMessage(chatId, `🔍 Ищу магазины с вакансией "${selectedVacancy}"...`,
    { reply_markup: { remove_keyboard: true } }
  );
  
  // Получаем данные из Google Sheets
  let shops;
  try {
    shops = await sheetsService.getDataForVacancy(selectedVacancy);
    if (!shops || shops.length === 0) {
      // Если нет данных, показываем заглушку
      shops = [
        {
          город: 'Москва',
          вакансия: selectedVacancy,
          адрес: 'ул. Тестовая, 1',
          тариф: 'от 50000 руб.',
          график: '5/2',
          'полный адрес': 'Москва, ул. Тестовая, д. 1',
          coordinates: { latitude: 55.7558, longitude: 37.6176 }
        }
      ];
    }
  } catch (error) {
    console.error('Ошибка загрузки магазинов:', error);
    shops = [
      {
        город: 'Москва',
        вакансия: selectedVacancy,
        адрес: 'ул. Тестовая, 1 (тестовые данные)',
        тариф: 'от 50000 руб.',
        график: '5/2',
        'полный адрес': 'Москва, ул. Тестовая, д. 1',
        coordinates: { latitude: 55.7558, longitude: 37.6176 }
      }
    ];
  }
  
  // Рассчитываем расстояние до каждого магазина и фильтруем те, у которых есть координаты
  const shopsWithDistance = shops
    .filter(shop => shop.coordinates && shop.coordinates.latitude && shop.coordinates.longitude)
    .map(shop => {
      const distance = sheetsService.calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        shop.coordinates.latitude,
        shop.coordinates.longitude
      );
      return {
        ...shop,
        distance: distance // расстояние в километрах
      };
    });
  
  // Сортируем по расстоянию (от ближайшего к дальнему)
  shopsWithDistance.sort((a, b) => a.distance - b.distance);
  
  // Берем только 5 ближайших магазинов
  const nearestShops = shopsWithDistance.slice(0, 5);
  
  // Сохраняем магазины с расстояниями
  userData[userId].availableShops = nearestShops;
  
  if (nearestShops.length === 0) {
    return bot.sendMessage(chatId,
      '❌ Не найдено магазинов с вакансией "' + selectedVacancy + '" в вашем регионе.\n\n' +
      'Попробуйте указать другое местоположение.',
      {
        reply_markup: {
          keyboard: [
            [{ text: '📍 Отправить местоположение', request_location: true }],
            [{ text: '⬅️ Назад к выбору вакансии' }]
          ],
          resize_keyboard: true
        }
      }
    );
  }
  
  // Форматируем расстояние для отображения
  const formatDistance = (km) => {
    if (km < 1) {
      return `${Math.round(km * 1000)} м`;
    } else if (km < 10) {
      return `${km.toFixed(1)} км`;
    } else {
      return `${Math.round(km)} км`;
    }
  };
  
  // Создаем клавиатуру с адресами и расстояниями
  const keyboard = nearestShops.map((shop, index) => {
    const distanceText = formatDistance(shop.distance);
    const addressText = `${shop['город']}, ${shop['адрес']}`;
    const buttonText = `${index + 1}. ${addressText} (${distanceText})`;
    return [{ text: buttonText }];
  });
  
  keyboard.push([{ text: '⬅️ Назад' }]);
  
  await bot.sendMessage(chatId,
    `🏪 Найдено *${nearestShops.length}* ближайших магазинов с вакансией "${selectedVacancy}":\n\n` +
    `Выберите магазин для просмотра деталей:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: keyboard,
        resize_keyboard: true,
        one_time_keyboard: false
      }
    }
  );
}

// Обработчик выбора магазина
async function handleShopSelection(bot, chatId, userId, text) {
  const data = userData[userId] || {};
  const shops = data.availableShops || [];
  
  if (text === '⬅️ Назад') {
    userStates[userId] = 'REQUESTING_LOCATION';
    
    await bot.sendMessage(chatId,
      'Отправьте местоположение или введите адрес:',
      {
        reply_markup: {
          keyboard: [
            [{ text: '📍 Отправить местоположение', request_location: true }],
            [{ text: '⬅️ Назад к выбору вакансии' }]
          ],
          resize_keyboard: true
        }
      }
    );
    return;
  }
  
  // Ищем выбранный магазин
  // Формат кнопки: "1. Город, Адрес (2.5 км)"
  const shopIndex = text.match(/^(\d+)\./);
  if (shopIndex) {
    const index = parseInt(shopIndex[1]) - 1;
    if (index >= 0 && index < shops.length) {
      const selectedShop = shops[index];
      
      userStates[userId] = 'SHOWING_VACANCY_DETAILS';
      userData[userId].selectedShop = selectedShop;
      
      // Формируем детальную информацию
      const detailsMessage = 
        `🏪 *${selectedShop['город']}, ${selectedShop['адрес']}*\n\n` +
        `📌 *Вакансия:* ${selectedShop['вакансия']}\n` +
        `💰 *Тариф:* ${selectedShop['тариф'] || 'не указано'}\n` +
        `📅 *График:* ${selectedShop['график'] || 'не указано'}\n` +
        `🎂 *Возраст:* ${selectedShop['возраст'] || 'не указано'}\n` +
        `🎁 *Описание:* ${selectedShop['описание'] || 'нет'}\n\n` +
        `📍 *Адрес:* ${selectedShop['полный адрес'] || selectedShop['адрес']}`;
      
      await bot.sendMessage(
        chatId,
        detailsMessage,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            keyboard: [
              [{ text: '✅ Откликнуться' }, { text: '⬅️ Назад к списку магазинов' }]
            ],
            resize_keyboard: true
          }
        }
      );
    }
  }
}

// Обработчик деталей вакансии
async function handleVacancyDetails(bot, chatId, userId, text) {
  const data = userData[userId] || {};
  const shops = data.availableShops || [];
  
  // Форматируем расстояние для отображения
  const formatDistance = (km) => {
    if (km < 1) {
      return `${Math.round(km * 1000)} м`;
    } else if (km < 10) {
      return `${km.toFixed(1)} км`;
    } else {
      return `${Math.round(km)} км`;
    }
  };
  
  if (text === '⬅️ Назад к списку магазинов') {
    userStates[userId] = 'SHOWING_SHOPS';
    
    const keyboard = shops.map((shop, index) => {
      const distanceText = shop.distance ? formatDistance(shop.distance) : '';
      const addressText = `${shop['город']}, ${shop['адрес']}`;
      const buttonText = distanceText ? `${index + 1}. ${addressText} (${distanceText})` : `${index + 1}. ${addressText}`;
      return [{ text: buttonText }];
    });
    keyboard.push([{ text: '⬅️ Назад' }]);
    
    await bot.sendMessage(
      chatId,
      `🏪 Магазины с вакансией "${data.selectedVacancy}":\n\n` +
      `Выберите магазин:`,
      {
        reply_markup: {
          keyboard: keyboard,
          resize_keyboard: true,
          one_time_keyboard: false
        }
      }
    );
  } else if (text === '✅ Откликнуться') {
    userStates[userId] = 'REQUESTING_FIO';
    await bot.sendMessage(chatId, 
      'Для оформления отклика введите ваши ФИО (Фамилия Имя Отчество):\n' +
      '*Пример:* Иванов Иван Иванович',
      {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      }
    );
  }
}

// Функция показа подтверждения (вынесена, чтобы можно было вызвать из разных мест)
async function showConfirmation(bot, chatId, userId) {
  const data = userData[userId];
  const shop = data.selectedShop || {};
  
  const confirmationMessage = 
    `✅ *Данные для отклика:*\n\n` +
    `📌 *Вакансия:* ${data.selectedVacancy}\n` +
    `🏪 *Магазин:* ${shop['город']}, ${shop['адрес']}\n` +
    `👤 *ФИО:* ${data.fio}\n` +
    `📱 *Телефон:* ${data.phone}\n` +
    `🎂 *Возраст:* ${data.age}\n\n` +
    `Всё верно?`;
  
  await bot.sendMessage(
    chatId,
    confirmationMessage,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [['✅ Да, отправить отклик'], ['❌ Нет, изменить']],
        resize_keyboard: true
      }
    }
  );
}

// Обработчик ввода ФИО
async function handleFioInput(bot, chatId, userId, text) {
  if (!text || text.trim().split(' ').length < 2) {
    return bot.sendMessage(chatId, '❌ Пожалуйста, введите полные ФИО (Фамилия Имя Отчество)');
  }
  
  console.log(`[FIO] Получено ФИО: ${text}`);
  
  userStates[userId] = 'REQUESTING_PHONE';
  userData[userId].fio = text.trim();
  
  await bot.sendMessage(chatId, 
    '✅ ФИО сохранено.\n\n' +
    'Теперь нажмите кнопку, чтобы поделиться номером телефона, или введите его вручную в формате 79XXXXXXXXX:',
    {
      reply_markup: {
        keyboard: [[{
          text: '📱 Поделиться номером телефона',
          request_contact: true
        }]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    }
  );
}

// Обработчик подтверждения
async function handleConfirmation(bot, chatId, userId, text) {
  if (text === '✅ Да, отправить отклик') {
    const data = userData[userId] || {};
    const shop = data.selectedShop || {};
    
    // Формируем сообщение для отправки в группу менеджеров
    const shopDistance = shop.distance 
      ? (shop.distance < 1 
          ? `${Math.round(shop.distance * 1000)} м` 
          : shop.distance < 10 
            ? `${shop.distance.toFixed(1)} км` 
            : `${Math.round(shop.distance)} км`)
      : 'не указано';
    
    // Получаем информацию о пользователе для ссылки
    let userLink = `[Ссылка на профиль](tg://user?id=${userId})`;
    try {
      const chatMember = await bot.getChatMember(chatId, userId);
      if (chatMember.user.username) {
        userLink = `[@${chatMember.user.username}](https://t.me/${chatMember.user.username})`;
      }
    } catch (e) {
      console.error('Ошибка получения информации о пользователе:', e.message);
    }

    const applicationMessage = 
      `🆕 *Новый отклик на вакансию*\n\n` +
      `🏢 *Проект:* ${shop['проект'] || 'не указано'}\n\n` +
      `📌 *Вакансия:* ${data.selectedVacancy || 'не указана'}\n` +
      `🏪 *Магазин:* ${shop['город'] || ''}, ${shop['адрес'] || 'не указан'}\n` +
      `📍 *Полный адрес:* ${shop['полный адрес'] || shop['адрес'] || 'не указан'}\n` +
      `📏 *Расстояние:* ${shopDistance}\n\n` +
      `👤 *ФИО:* ${data.fio || 'не указано'}\n` +
      `🎂 *Возраст кандидата:* ${data.age || 'не указан'}\n` +
      `📱 *Телефон:* ${data.phone || 'не указан'}\n` +
      `🔗 *Telegram:* ${userLink}\n\n` +
      `💰 *Тариф:* ${shop['тариф'] || 'не указано'}\n` +
      `📅 *График:* ${shop['график'] || 'не указано'}\n` +
      `🎂 *Возраст:* ${shop['возраст'] || 'не указано'}\n` +
      `🕐 *Время отклика:* ${new Date().toLocaleString('ru-RU', { 
        timeZone: 'Europe/Moscow',
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit', 
        minute: '2-digit' 
      })}`;
    
    // Отправляем отклик в групповой чат менеджеров
    const managerChatId = process.env.MANAGER_CHAT_ID;
    
    if (managerChatId) {
      try {
        await bot.sendMessage(
          managerChatId,
          applicationMessage,
          {
            parse_mode: 'Markdown'
          }
        );
        console.log(`✅ Отклик отправлен в группу менеджеров (chat_id: ${managerChatId})`);
      } catch (error) {
        console.error(`❌ Ошибка отправки отклика в группу:`, error.message);
        // Не прерываем процесс, просто логируем ошибку
      }
    } else {
      console.warn('⚠️ MANAGER_CHAT_ID не установлен в .env файле. Отклик не отправлен в группу.');
    }
    
    await bot.sendMessage(chatId,
      '🎉 Ваш отклик отправлен менеджеру!\n\n' +
      'С вами свяжутся в ближайшее время.\n\n' +
      'Для нового поиска нажмите /start',
      { reply_markup: { remove_keyboard: true } }
    );
    
    // Сбрасываем состояние
    delete userStates[userId];
    delete userData[userId];
    
  } else if (text === '❌ Нет, изменить') {
    userStates[userId] = 'START';
    await bot.sendMessage(chatId, 'Начните заново с /start');
  }
}

// Команда /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📋 *Помощь*\n\n' +
    '*/start* - Начать поиск вакансии\n' +
    '*/help* - Эта справка\n' +
    '*/cancel* - Отменить текущую операцию\n\n' +
    '*Процесс работы:*\n' +
    '1️⃣ Выберите вакансию\n' +
    '2️⃣ Укажите местоположение\n' +
    '3️⃣ Выберите магазин\n' +
    '4️⃣ Введите ФИО\n' +
    '5️⃣ Предоставьте номер телефона\n' +
    '6️⃣ Откликнитесь на вакансию',
    { parse_mode: 'Markdown' }
  );
});

// Команда /cancel
bot.onText(/\/cancel/, (msg) => {
  const userId = msg.from.id;
  delete userStates[userId];
  delete userData[userId];
  
  bot.sendMessage(msg.chat.id,
    '❌ Операция отменена. Нажмите /start для начала.',
    { reply_markup: { remove_keyboard: true } }
  );
});

// Обработка ошибок
bot.on('polling_error', (error) => {
  console.error('❌ Ошибка polling:', error.message);
});

bot.on('error', (error) => {
  console.error('❌ Общая ошибка бота:', error);
});

console.log('✅ Бот с Google Sheets запущен!');
console.log('📱 Отправьте /start в Telegram для тестирования');
