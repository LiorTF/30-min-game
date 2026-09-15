/* Suspect — word deck.
   Twenty categories, ten words each. Every entry is [hebrew, english].
   Words are chosen to be guessable by a mixed-age table and to give an
   impostor something to bluff with: nothing so obscure that a clue is
   impossible, nothing so narrow that one clue ends the round. */
window.SUSPECT_DECK = [
  { id:"food", c:{he:"אוכל", en:"Food"}, w:[
    ["פלאפל","Falafel"],["שוקולד","Chocolate"],["אבטיח","Watermelon"],["פיצה","Pizza"],["חומוס","Hummus"],
    ["סושי","Sushi"],["גלידה","Ice cream"],["שקשוקה","Shakshuka"],["מרק עוף","Chicken soup"],["פופקורן","Popcorn"]]},
  { id:"animals", c:{he:"חיות", en:"Animals"}, w:[
    ["פיל","Elephant"],["נחש","Snake"],["דולפין","Dolphin"],["ג׳וק","Cockroach"],["חתול","Cat"],
    ["נמר","Tiger"],["פינגווין","Penguin"],["גמל","Camel"],["יתוש","Mosquito"],["כלב","Dog"]]},
  { id:"places", c:{he:"מקומות", en:"Places"}, w:[
    ["שדה תעופה","Airport"],["מדבר","Desert"],["שוק","Market"],["בית חולים","Hospital"],["חוף הים","The beach"],
    ["מלון","Hotel"],["ספרייה","Library"],["תחנת דלק","Petrol station"],["פסגת הר","Mountain top"],["מערה","Cave"]]},
  { id:"jobs", c:{he:"מקצועות", en:"Professions"}, w:[
    ["רופא שיניים","Dentist"],["שוטר","Police officer"],["טייס","Pilot"],["מורה","Teacher"],["שף","Chef"],
    ["עורך דין","Lawyer"],["ספר","Barber"],["חקלאי","Farmer"],["כבאי","Firefighter"],["שחקן","Actor"]]},
  { id:"house", c:{he:"בבית", en:"Around the house"}, w:[
    ["מקרר","Fridge"],["מברשת שיניים","Toothbrush"],["שואב אבק","Vacuum cleaner"],["מזגן","Air conditioner"],["מראה","Mirror"],
    ["כרית","Pillow"],["מטרייה","Umbrella"],["מספריים","Scissors"],["מכונת כביסה","Washing machine"],["שלט רחוק","Remote control"]]},
  { id:"sport", c:{he:"ספורט", en:"Sport"}, w:[
    ["כדורגל","Football"],["שחייה","Swimming"],["שחמט","Chess"],["מרתון","Marathon"],["טניס","Tennis"],
    ["אגרוף","Boxing"],["יוגה","Yoga"],["סקי","Skiing"],["כדורסל","Basketball"],["ריקוד","Dancing"]]},
  { id:"emotion", c:{he:"רגשות", en:"Emotions"}, w:[
    ["קנאה","Jealousy"],["גאווה","Pride"],["בושה","Shame"],["געגוע","Longing"],["פחד","Fear"],
    ["שעמום","Boredom"],["אהבה","Love"],["כעס","Anger"],["הקלה","Relief"],["תקווה","Hope"]]},
  { id:"tech", c:{he:"טכנולוגיה", en:"Technology"}, w:[
    ["סמארטפון","Smartphone"],["סיסמה","Password"],["רובוט","Robot"],["וויפיי","Wi-Fi"],["מצלמה","Camera"],
    ["אוזניות","Headphones"],["בינה מלאכותית","Artificial intelligence"],["סוללה","Battery"],["מסך כחול","Blue screen"],["הודעה קולית","Voice note"]]},
  { id:"holiday", c:{he:"חגים ומסורת", en:"Holidays & tradition"}, w:[
    ["סופגנייה","Sufganiyah"],["ליל הסדר","Seder night"],["סוכה","Sukkah"],["שופר","Shofar"],["תחפושת","Costume"],
    ["נרות שבת","Shabbat candles"],["מתנה","A gift"],["חופה","Chuppah"],["צום","Fasting"],["אפיקומן","Afikoman"]]},
  { id:"family", c:{he:"משפחה", en:"Family"}, w:[
    ["סבתא","Grandma"],["חתונה","Wedding"],["ויכוח","An argument"],["תמונה משפחתית","Family photo"],["ירושה","Inheritance"],
    ["טיול משפחתי","Family trip"],["שכן","The neighbour"],["תאומים","Twins"],["גיס","Brother-in-law"],["אלבום תמונות","Photo album"]]},
  { id:"transport", c:{he:"תחבורה", en:"Getting around"}, w:[
    ["אופניים","Bicycle"],["רכבת","Train"],["פקק תנועה","Traffic jam"],["מונית","Taxi"],["אונייה","Ship"],
    ["קורקינט","Scooter"],["מטוס","Aeroplane"],["מעלית","Lift"],["רמזור","Traffic light"],["חניה","Parking"]]},
  { id:"music", c:{he:"מוזיקה", en:"Music"}, w:[
    ["גיטרה","Guitar"],["תזמורת","Orchestra"],["קריוקי","Karaoke"],["תופים","Drums"],["מקהלה","Choir"],
    ["שיר ערש","Lullaby"],["הופעה","A concert"],["פסנתר","Piano"],["רדיו","Radio"],["מחיאות כפיים","Applause"]]},
  { id:"screen", c:{he:"מסך", en:"On screen"}, w:[
    ["סדרה","A series"],["קליפ","Music video"],["סוף עצוב","A sad ending"],["נבל","The villain"],["פרסומת","An advert"],
    ["חדשות","The news"],["ריאליטי","Reality show"],["סרט אימה","Horror film"],["ספוילר","A spoiler"],["קרדיטים","The credits"]]},
  { id:"clothes", c:{he:"בגדים", en:"Clothes"}, w:[
    ["נעליים","Shoes"],["כובע","Hat"],["עניבה","Tie"],["גרביים","Socks"],["משקפי שמש","Sunglasses"],
    ["חליפה","A suit"],["פיג׳מה","Pyjamas"],["תיק","Bag"],["טבעת","Ring"],["מעיל","Coat"]]},
  { id:"nature", c:{he:"טבע ומזג אוויר", en:"Nature & weather"}, w:[
    ["סופה","Storm"],["קשת בענן","Rainbow"],["שלג","Snow"],["ירח מלא","Full moon"],["רעידת אדמה","Earthquake"],
    ["חמסין","Heatwave"],["יער","Forest"],["גלים","Waves"],["ברק","Lightning"],["שקיעה","Sunset"]]},
  { id:"body", c:{he:"גוף האדם", en:"The human body"}, w:[
    ["לב","Heart"],["שיער","Hair"],["עיניים","Eyes"],["ברך","Knee"],["קול","Voice"],
    ["טביעת אצבע","Fingerprint"],["שן","Tooth"],["צחוק","Laughter"],["נשימה","A breath"],["דמעה","A tear"]]},
  { id:"work", c:{he:"כסף ועבודה", en:"Money & work"}, w:[
    ["משכורת","Salary"],["חשבון","The bill"],["הלוואה","A loan"],["ראיון עבודה","Job interview"],["בונוס","Bonus"],
    ["פנסיה","Pension"],["מיסים","Taxes"],["ארנק","Wallet"],["פגישה","A meeting"],["שביתה","A strike"]]},
  { id:"childhood", c:{he:"ילדות", en:"Childhood"}, w:[
    ["נדנדה","A swing"],["קלמר","Pencil case"],["הפסקה","Break time"],["יום הולדת","Birthday"],["שיעורי בית","Homework"],
    ["ממתק","A sweet"],["דובי","Teddy bear"],["מחבואים","Hide and seek"],["גן שעשועים","Playground"],["חבר דמיוני","Imaginary friend"]]},
  { id:"israel", c:{he:"ישראל", en:"Israel"}, w:[
    ["תל אביב","Tel Aviv"],["הכנרת","The Kinneret"],["ארוחת שישי","Friday night dinner"],["מחנה יהודה","Mahane Yehuda"],["הכותל","The Western Wall"],
    ["אילת","Eilat"],["קיבוץ","Kibbutz"],["עברית","Hebrew"],["הנגב","The Negev"],["טיול אחרי צבא","Post-army trip"]]},
  { id:"fear", c:{he:"דברים מפחידים", en:"Things that scare us"}, w:[
    ["חושך","The dark"],["גובה","Heights"],["בדידות","Loneliness"],["סיוט","A nightmare"],["עכביש","Spider"],
    ["איחור","Being late"],["דיבור מול קהל","Public speaking"],["מנהרה","A tunnel"],["להיאבד","Getting lost"],["מחט","A needle"]]}
];

/* Packs group the categories so a table can choose its own flavour, and so
   a long-running table can retire the ones it knows by heart. */
window.SUSPECT_PACKS = [
  { id: "base",    he: "בסיס",          en: "Everyday",     cats: ["food", "animals", "places", "jobs", "house", "sport"] },
  { id: "mind",    he: "ראש ולב",       en: "Head & heart", cats: ["emotion", "body", "fear", "childhood"] },
  { id: "culture", he: "תרבות",         en: "Culture",      cats: ["music", "screen", "clothes", "tech"] },
  { id: "home",    he: "בית וישראל",    en: "Home",         cats: ["holiday", "family", "israel", "nature", "transport", "work"] }
];
