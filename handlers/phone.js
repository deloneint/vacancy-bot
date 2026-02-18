const config = require('../config');
const { setState, setUserData, getState } = require('../userStates');
const googleSheets = require('../googleSheet');

module.exports = (bot) => {
  bot.on('contact', async (msg) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const contact = msg.contact;
      
      if (!contact) {
        console.error('[PHONE] Нет данных контакта');
        return;
      }
      
      // Проверяем, что контакт принадлежит отправителю
      if (contact.user_id !== userId) {
        return bot.sendMessage(
          chatId, 
          '❌ Пожалуйста, поделитесь своим номером телефона, а не чужим.'
        );
      }
      
      // Проверяем, что пользователь в правильном состоянии
      const currentState = getState(userId);
      if (currentState !== config.USER_STATES.START) {
        return bot.sendMessage(
          chatId,
          'Пожалуйста, завершите текущую операцию или начните заново с /start'
        );
      }
      
      const phoneNumber = contact.phone_number;
      console.log(`[PHONE] Пользователь ${userId} предоставил номер: ${phoneNumber}`);
      
      // Сохраняем номер телефона
      setUserData(userId, 'phone', phoneNumber);
      
      // Меняем состояние на ВЫБОР ВАКАНСИИ (не проекта!)
      setState(userId, config.USER_STATES.CHOOSING_VACANCY);
      
      // Получаем вакансии из Google Sheets
      let vacancies;
      try {
        vacancies = await googleSheets.getVacancies();
        if (!vacancies || vacancies.length === 0) {
          vacancies = ['Кассир', 'Уборщик', 'Повар']; // Заглушка при ошибке
        }
      } catch (error) {
        console.error('[PHONE] Ошибка загрузки вакансий:', error.message);
        vacancies = ['Кассир', 'Уборщик', 'Менеджер', 'Повар', 'Бариста'];
      }
      
      // Сообщение об успешном получении номера
      const responseMessage = `✅ Спасибо! Ваш номер телефона сохранен: ${phoneNumber}\n\n` +
                             `Теперь выберите интересующую вас вакансию:`;
      
      // Создаем клавиатуру с вакансиями
      // Разбиваем на группы по 2 вакансии в строке для лучшего отображения
      const keyboard = [];
      for (let i = 0; i < vacancies.length; i += 2) {
        const row = vacancies.slice(i, i + 2).map(vacancy => ({ text: vacancy }));
        keyboard.push(row);
      }
      
      const vacancyKeyboard = {
        reply_markup: {
          keyboard: keyboard,
          resize_keyboard: true,
          one_time_keyboard: true
        }
      };
      
      await bot.sendMessage(chatId, responseMessage, vacancyKeyboard);
    } catch (error) {
      console.error('[PHONE] Ошибка обработки контакта:', error);
      await bot.sendMessage(msg.chat.id, '⚠️ Произошла ошибка. Попробуйте еще раз /start');
    }
  });
};