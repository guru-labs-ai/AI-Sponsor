/* ─── The automatic messages in the nine remaining languages ─────────────────
   The sponsor speaks sixteen languages, because that is what the voice
   supports. Until Sep 17 the automatic messages existed in seven, so somebody
   who chose Japanese still got their trial reminder in English. Mariam: "why
   would users get english notes and reminders if they havent chosen english?
   no logic in that". Quite.

   Same two voices as notice-copy.js, and the same rule: the service speaks in
   the openers, the account notices and the trial, the sponsor speaks in the
   weekly note and the check-ins.

   Held as plain strings with {first}, {when} and {link} in them, rather than as
   template literals, because they were translated as data and validated as
   data: every placeholder, every line break and every button length was checked
   against the English before this file was written. build() at the bottom turns
   them into the exact function shapes the other six languages already use, so
   nothing downstream knows the difference.

   ⭐ NOT REVIEWED BY A NATIVE SPEAKER YET. Ordered by the number of people the
   product has in each: nobody is using most of these today, and the English
   they replace was not reviewed by anyone either.

   The {{1}} and {{2}} strings are WhatsApp templates and must match what Meta
   holds, word for word, or the send is refused. */

const DATA = {
  /* Turkish */
  tr: {
    "serviceNameFallback": "Merhaba",
    "sponsorNameFallback": "arkadaşım",
    "opener": {
      "withName": "{first}, hesabınızla ilgili kısa bir not, sponsorunuzdan gelen bir mesaj değil.",
      "noName": "Hesabınızla ilgili kısa bir not, sponsorunuzdan gelen bir mesaj değil."
    },
    "leaving": {
      "deleteOnly": "Hesabınızı ve içindeki her şeyi silme talebinizi aldık. Bu işlem {when} tarihinde yapılacak.",
      "cardAndDelete": "Aboneliğiniz hemen iptal edildi, kartınızdan artık başka bir ödeme alınmayacak. Ayrıca hesabınızı ve içindeki her şeyi silme talebinizi de aldık, bu işlem {when} tarihinde yapılacak.",
      "nothingYet": "Henüz hiçbir şey silinmedi, o güne kadar sponsorunuz tam olarak eskisi gibi çalışmaya devam ediyor. ",
      "withLink": "O tarihten önce dilediğiniz zaman buradan kendiniz durdurabilirsiniz:\n\n{link}\n\nYa da bu mesaja yanıt verin, biz sizin için yapalım. Her iki durumda da hiçbir şeyinizi kaybetmiş olmayacaksınız.",
      "noLink": "O tarihten önce dilediğiniz zaman bu mesaja yanıt vermeniz yeterli, biz durduralım, hiçbir şeyinizi kaybetmiş olmayacaksınız.",
      "button": "Hesabımı koru",
      "templateBeta": "Merhaba {{1}}, hesabınızla ilgili kısa bir not, sponsorunuzdan gelen bir mesaj değil. Hesabınızı ve içindeki her şeyi silme talebinizi aldık, bu işlem {{2}} tarihinde yapılacak. Henüz hiçbir şey silinmedi, o güne kadar sponsorunuz tam olarak eskisi gibi çalışmaya devam ediyor. Aşağıdaki düğmeyle ya da buraya yanıt vererek, o tarihten önce dilediğiniz zaman durdurabilirsiniz.",
      "templatePaid": "Merhaba {{1}}, hesabınızla ilgili kısa bir not, sponsorunuzdan gelen bir mesaj değil. Aboneliğiniz hemen iptal edildi, kartınızdan artık başka bir ödeme alınmayacak. Ayrıca hesabınızı ve içindeki her şeyi silme talebinizi de aldık, bu işlem {{2}} tarihinde yapılacak. Henüz hiçbir şey silinmedi, o güne kadar sponsorunuz tam olarak eskisi gibi çalışmaya devam ediyor. Aşağıdaki düğmeyle ya da buraya yanıt vererek, o tarihten önce dilediğiniz zaman durdurabilirsiniz."
    },
    "trial": {
      "body": "30 günlük ücretsiz süreniz {when} tarihinde bitiyor ve ayda 5 dolarlık plan o gün başlıyor. İstemiyorsanız buradan durdurabilirsiniz:\n\n{link}\n\nHer durumda, bugün benimle konuşma şeklinizde hiçbir şey değişmiyor.",
      "button": "Planımı yönet",
      "template": "Merhaba {{1}}, AI Sponsor hesabınızla ilgili kısa bir not, sponsorunuzdan gelen bir mesaj değil. 30 günlük ücretsiz süreniz {{2}} tarihinde bitiyor ve ayda 5 dolarlık plan o gün başlıyor. Planınızı dilediğiniz zaman değiştirebilir ya da iptal edebilirsiniz.",
      "templateV2": "Merhaba {{1}}, ücretsiz AI Sponsor deneme süreniz {{2}} tarihinde bitiyor. O gün aylık 5 dolarlık abonelik kartınızdan tahsil edilecek. Bu tarihten önce aşağıdaki düğmeyle planınızı değiştirebilir ya da iptal edebilirsiniz. Bu bir hesap bildirimi, sponsorunuzdan gelen bir mesaj değil."
    },
    "weekly": {
      "greet": "{first}, ",
      "hard": "bu haftayı düşünüyordum. Senin için birkaç şey yazdım, sadece istersen diye:\n\n{link}\n\nCevap vermene gerek yok. Ne olursa olsun buradayım.",
      "quiet": "aramızda sessiz bir hafta oldu, sorun değil. İstersen diye burada kısa bir not bıraktım:\n\n{link}",
      "good": "haftana dönüp baktım ve senin için yazdım. Ne zaman istersen burada:\n\n{link}",
      "button": "Haftanı gör",
      "templates": {
        "hard": "Merhaba {{1}}, bu haftayı düşünüyordum. Senin için birkaç şey yazdım, sadece istersen diye. Cevap vermene gerek yok. Ne olursa olsun buradayım.",
        "quiet": "Merhaba {{1}}, aramızda sessiz bir hafta oldu, sorun değil. İstersen diye kısa bir not bıraktım.",
        "good": "Merhaba {{1}}, haftana dönüp baktım ve senin için yazdım. Ne zaman istersen burada."
      },
      "privacy": "\n\nAyrıca gizlilik politikamızı güncelledik, neleri sakladığımı ve bunları nasıl sileceğini orada anlatıyoruz. Bağlantı o sayfanın en üstünde."
    },
    "weeklyReady": {
      "template": "Merhaba {{1}}, AI Sponsor'dan haftalık notunuz hazır. Aşağıdaki düğmeyle hesap sayfanızdan okuyabilirsiniz.",
      "button": "Haftanızı görün"
    },
    "quietCard": {
      "none": "Bu hafta konuşmadık. Bu olabilir ve hiçbir şeyi geçersiz kılmaz. İstediğin zaman buradayım, önce telafi etmen gereken bir şey yok.",
      "some": "Aramızda sessiz bir hafta. Bu bir başarısızlık değil, ben puan tutmuyorum. Doğru dürüst konuşmak istediğin an buradayım.",
      "nextWeek": "Bu hafta benden bir görev yok. Bir şey olduğunda bana yaz, küçük bir şey olsa bile."
    },
    "checkin": {
      "hi": "Merhaba {first}, ",
      "text": "birkaç gün oldu. Özel bir sebebi yok, sadece nasıl olduğunu merak ettim.",
      "template": "Merhaba {{1}}, birkaç gün oldu. Özel bir sebebi yok, sadece nasıl olduğunu merak ettim."
    },
    "checkinRequested": {
      "template": "Merhaba {{1}}, birkaç gün sizden haber alamazsam size yazmamı istemiştiniz, işte buradayım. Konuşmak istediğinizde yanıt verebilirsiniz. Bu hatırlatmaları ayarlar sayfanızdan kapatabilirsiniz.",
      "button": "Hatırlatmaları yönet"
    }
  },
  /* Arabic */
  ar: {
    "serviceNameFallback": "عزيزي",
    "sponsorNameFallback": "صديقي",
    "opener": {
      "withName": "{first}، ملاحظة سريعة بخصوص حسابك، وليست رسالة من راعيك.",
      "noName": "ملاحظة سريعة بخصوص حسابك، وليست رسالة من راعيك."
    },
    "leaving": {
      "deleteOnly": "وصلنا طلبك بحذف حسابك وكل ما فيه. سيتم ذلك في {when}.",
      "cardAndDelete": "تم إلغاء اشتراكك فوراً، لذلك لن يُخصم أي مبلغ آخر من بطاقتك. ووصلنا أيضاً طلبك بحذف حسابك وكل ما فيه، وسيتم ذلك في {when}.",
      "nothingYet": "لم يُحذف أي شيء حتى الآن، وراعيك يعمل كما كان تماماً حتى ذلك الحين. ",
      "withLink": "يمكنك إيقاف ذلك بنفسك من هنا، في أي وقت قبل ذلك التاريخ:\n\n{link}\n\nأو رُدّ على هذه الرسالة وسنقوم بذلك عنك. في كل الحالات لن تفقد أي شيء.",
      "noLink": "رُدّ على هذه الرسالة في أي وقت قبل ذلك التاريخ وسنوقف العملية، ولن تفقد أي شيء.",
      "button": "الاحتفاظ بحسابي",
      "templateBeta": "مرحباً {{1}}، ملاحظة سريعة بخصوص حسابك، وليست رسالة من راعيك. وصلنا طلبك بحذف حسابك وكل ما فيه، وسيتم ذلك في {{2}}. لم يُحذف أي شيء حتى الآن وراعيك يعمل كما كان تماماً حتى ذلك الحين. يمكنك إيقاف ذلك بالزر أدناه، أو بالرد هنا، في أي وقت قبل ذلك التاريخ.",
      "templatePaid": "مرحباً {{1}}، ملاحظة سريعة بخصوص حسابك، وليست رسالة من راعيك. تم إلغاء اشتراكك فوراً، لذلك لن يُخصم أي مبلغ آخر من بطاقتك. ووصلنا أيضاً طلبك بحذف حسابك وكل ما فيه، وسيتم ذلك في {{2}}. لم يُحذف أي شيء حتى الآن وراعيك يعمل كما كان تماماً حتى ذلك الحين. يمكنك إيقاف ذلك بالزر أدناه، أو بالرد هنا، في أي وقت قبل ذلك التاريخ."
    },
    "trial": {
      "body": "تنتهي أيامك الثلاثون المجانية في {when}، وتبدأ بعدها خطة 5 دولارات شهرياً. إن كنت تفضل غير ذلك، يمكنك إيقافها من هنا:\n\n{link}\n\nفي كل الحالات، لا شيء يتغير في طريقة حديثك معي اليوم.",
      "button": "إدارة خطتي",
      "template": "مرحباً {{1}}، ملاحظة سريعة بخصوص حسابك في AI Sponsor، وليست رسالة من راعيك. تنتهي أيامك الثلاثون المجانية في {{2}} وتبدأ بعدها خطة 5 دولارات شهرياً. يمكنك تغييرها أو إلغاؤها في أي وقت.",
      "templateV2": "مرحباً {{1}}، تنتهي فترتك التجريبية المجانية في AI Sponsor في {{2}}. في ذلك اليوم سيُخصم اشتراك 5 دولارات الشهري من بطاقتك. يمكنك تغيير خطتك أو إلغاؤها قبل ذلك التاريخ بالزر أدناه. هذا إشعار خاص بالحساب، وليس رسالة من راعيك."
    },
    "weekly": {
      "greet": "{first}، ",
      "hard": "كنت أفكر في أسبوعك. كتبت لك بعض الأشياء، فقط إن أردتها:\n\n{link}\n\nلا حاجة للرد. أنا هنا في كل الحالات.",
      "quiet": "أسبوع هادئ بيننا، ولا مشكلة في ذلك. تركت لك ملاحظة قصيرة هنا إن أردتها:\n\n{link}",
      "good": "راجعت أسبوعك وكتبته لك. إنه هنا وقتما أردت:\n\n{link}",
      "button": "شاهد أسبوعك",
      "templates": {
        "hard": "مرحباً {{1}}، كنت أفكر في أسبوعك. كتبت لك بعض الأشياء، فقط إن أردتها. لا حاجة للرد. أنا هنا في كل الحالات.",
        "quiet": "مرحباً {{1}}، أسبوع هادئ بيننا، ولا مشكلة في ذلك. تركت لك ملاحظة قصيرة إن أردتها.",
        "good": "مرحباً {{1}}، راجعت أسبوعك وكتبته لك. إنه هنا وقتما أردت."
      },
      "privacy": "\n\nكما حدّثنا سياسة الخصوصية، وهي توضح ما أحفظه وكيف تحذفه. الرابط موجود في أعلى تلك الصفحة."
    },
    "weeklyReady": {
      "template": "مرحباً {{1}}، ملاحظتك الأسبوعية من AI Sponsor جاهزة. يمكنك قراءتها في صفحة حسابك بالزر أدناه.",
      "button": "شاهد أسبوعك"
    },
    "quietCard": {
      "none": "لم نتحدث هذا الأسبوع. لا مشكلة في ذلك، وهو لا يُلغي شيئاً مما قبله. أنا هنا وقتما أردتني، ولا يوجد ما يجب تعويضه أولاً.",
      "some": "أسبوع هادئ بيننا. هذا ليس فشلاً وأنا لا أحسب عليك شيئاً. وقتما أردت أن نتحدث بجدية، أنا هنا.",
      "nextWeek": "لا مهمة مني هذا الأسبوع. فقط راسلني حين يحدث شيء، ولو كان صغيراً."
    },
    "checkin": {
      "hi": "مرحباً {first}، ",
      "text": "مضت بضعة أيام. لا سبب معين، أردت فقط أن أعرف كيف حالك.",
      "template": "مرحباً {{1}}، مضت بضعة أيام. لا سبب معين، أردت فقط أن أعرف كيف حالك."
    },
    "checkinRequested": {
      "template": "مرحباً {{1}}، طلبت مني أن أطمئن عليك إن لم أسمع منك لبضعة أيام، وها أنا. رُدّ وقتما أردت أن نتحدث. يمكنك إيقاف رسائل الاطمئنان من صفحة الإعدادات.",
      "button": "إدارة رسائل الاطمئنان"
    }
  },
  /* Hindi */
  hi: {
    "serviceNameFallback": "जी",
    "sponsorNameFallback": "दोस्त",
    "opener": {
      "withName": "{first}, आपके खाते के बारे में एक छोटी सूचना, यह आपके स्पॉन्सर का संदेश नहीं है।",
      "noName": "आपके खाते के बारे में एक छोटी सूचना, यह आपके स्पॉन्सर का संदेश नहीं है।"
    },
    "leaving": {
      "deleteOnly": "हमें आपका अनुरोध मिल गया है कि आपका खाता और उसमें मौजूद सब कुछ मिटा दिया जाए। यह {when} को कर दिया जाएगा।",
      "cardAndDelete": "आपकी सदस्यता तुरंत रद्द कर दी गई है, इसलिए आपके कार्ड से आगे कुछ नहीं लिया जाएगा। साथ ही हमें आपका यह अनुरोध भी मिला है कि आपका खाता और उसमें मौजूद सब कुछ मिटा दिया जाए, और यह {when} को कर दिया जाएगा।",
      "nothingYet": "अभी तक कुछ नहीं हटाया गया है, और तब तक आपका स्पॉन्सर पहले की तरह ही काम करता रहेगा। ",
      "withLink": "उस तारीख से पहले कभी भी आप इसे यहाँ से खुद रोक सकते हैं:\n\n{link}\n\nया इस संदेश का जवाब दे दीजिए, हम आपके लिए रोक देंगे। किसी भी हाल में आपका कुछ नहीं खोएगा।",
      "noLink": "उस तारीख से पहले कभी भी इस संदेश का जवाब दे दीजिए, हम इसे रोक देंगे और आपका कुछ नहीं खोएगा।",
      "button": "खाता बनाए रखें",
      "templateBeta": "नमस्ते {{1}}, आपके खाते के बारे में एक छोटी सूचना, यह आपके स्पॉन्सर का संदेश नहीं है। हमें आपका अनुरोध मिल गया है कि आपका खाता और उसमें मौजूद सब कुछ मिटा दिया जाए, और यह {{2}} को कर दिया जाएगा। अभी तक कुछ नहीं हटाया गया है और तब तक आपका स्पॉन्सर पहले की तरह ही काम करता रहेगा। उस तारीख से पहले कभी भी आप नीचे दिए बटन से, या यहाँ जवाब देकर, इसे रोक सकते हैं।",
      "templatePaid": "नमस्ते {{1}}, आपके खाते के बारे में एक छोटी सूचना, यह आपके स्पॉन्सर का संदेश नहीं है। आपकी सदस्यता तुरंत रद्द कर दी गई है, इसलिए आपके कार्ड से आगे कुछ नहीं लिया जाएगा। साथ ही हमें आपका यह अनुरोध भी मिला है कि आपका खाता और उसमें मौजूद सब कुछ मिटा दिया जाए, और यह {{2}} को कर दिया जाएगा। अभी तक कुछ नहीं हटाया गया है और तब तक आपका स्पॉन्सर पहले की तरह ही काम करता रहेगा। उस तारीख से पहले कभी भी आप नीचे दिए बटन से, या यहाँ जवाब देकर, इसे रोक सकते हैं।"
    },
    "trial": {
      "body": "आपके 30 मुफ्त दिन {when} को खत्म हो रहे हैं, और उसी दिन से महीने के $5 वाला प्लान शुरू हो जाएगा। अगर आप ऐसा नहीं चाहते, तो यहाँ से रोक सकते हैं:\n\n{link}\n\nजो भी हो, आज आप मुझसे जिस तरह बात करते हैं, उसमें कुछ नहीं बदलेगा।",
      "button": "प्लान मैनेज करें",
      "template": "नमस्ते {{1}}, आपके AI Sponsor खाते के बारे में एक छोटी सूचना, यह आपके स्पॉन्सर का संदेश नहीं है। आपके 30 मुफ्त दिन {{2}} को खत्म हो रहे हैं और उसी दिन से महीने के $5 वाला प्लान शुरू हो जाएगा। आप इसे कभी भी बदल या रद्द कर सकते हैं।",
      "templateV2": "नमस्ते {{1}}, आपका मुफ्त AI Sponsor ट्रायल {{2}} को खत्म हो रहा है। उस दिन आपके कार्ड से महीने की 5 USD की सदस्यता ली जाएगी। उस तारीख से पहले नीचे दिए बटन से आप अपना प्लान बदल या रद्द कर सकते हैं। यह खाते की सूचना है, आपके स्पॉन्सर का संदेश नहीं।"
    },
    "weekly": {
      "greet": "{first}, ",
      "hard": "आपके इस हफ्ते का ख्याल मेरे मन में था। आपके लिए कुछ बातें लिख दी हैं, बस तब पढ़िए जब मन हो:\n\n{link}\n\nजवाब देने की ज़रूरत नहीं। मैं हर हाल में यहीं हूँ।",
      "quiet": "हमारे बीच यह हफ्ता शांत रहा, और यह ठीक है। मन हो तो पढ़ लीजिए, आपके लिए एक छोटा नोट यहाँ छोड़ा है:\n\n{link}",
      "good": "मैंने आपके पूरे हफ्ते पर नज़र डाली और उसे आपके लिए लिख दिया। जब मन हो, यह यहाँ है:\n\n{link}",
      "button": "अपना हफ्ता देखें",
      "templates": {
        "hard": "नमस्ते {{1}}, आपके इस हफ्ते का ख्याल मेरे मन में था। आपके लिए कुछ बातें लिख दी हैं, बस तब पढ़िए जब मन हो। जवाब देने की ज़रूरत नहीं। मैं हर हाल में यहीं हूँ।",
        "quiet": "नमस्ते {{1}}, हमारे बीच यह हफ्ता शांत रहा, और यह ठीक है। मन हो तो पढ़ लीजिए, आपके लिए एक छोटा नोट छोड़ा है।",
        "good": "नमस्ते {{1}}, मैंने आपके पूरे हफ्ते पर नज़र डाली और उसे आपके लिए लिख दिया। जब मन हो, यह यहाँ है।"
      },
      "privacy": "\n\nहमने अपनी प्राइवेसी पॉलिसी भी अपडेट की है, जिसमें बताया गया है कि क्या सहेजा जाता है और उसे कैसे मिटाया जा सकता है। उसका लिंक उस पेज के ऊपर है।"
    },
    "weeklyReady": {
      "template": "नमस्ते {{1}}, AI Sponsor की तरफ से आपका साप्ताहिक नोट तैयार है। नीचे दिए बटन से आप इसे अपने खाते के पेज पर पढ़ सकते हैं।",
      "button": "अपना हफ्ता देखें"
    },
    "quietCard": {
      "none": "इस हफ्ते हमारी बात नहीं हुई। यह भी ठीक है, और इससे कुछ छूटता नहीं। जब आपका मन हो, मैं यहाँ हूँ, और पहले कोई भरपाई करने की ज़रूरत नहीं।",
      "some": "हमारे बीच एक शांत हफ्ता। यह कोई नाकामी नहीं है और यहाँ कोई हिसाब किताब नहीं होता। जब भी ठीक से बात करने का मन हो, मैं यहाँ हूँ।",
      "nextWeek": "इस हफ्ते मेरी तरफ से कोई काम नहीं। जब कुछ भी मन में आए, छोटी बात हो तो भी, मुझे मैसेज कर दीजिए।"
    },
    "checkin": {
      "hi": "नमस्ते {first}, ",
      "text": "कुछ दिन हो गए। कोई खास वजह नहीं, बस यह जानना था कि आप कैसे हैं।",
      "template": "नमस्ते {{1}}, कुछ दिन हो गए। कोई खास वजह नहीं, बस यह जानना था कि आप कैसे हैं।"
    },
    "checkinRequested": {
      "template": "नमस्ते {{1}}, आपने कहा था कि कुछ दिन आपकी कोई खबर न मिले तो हाल पूछ लिया जाए, इसलिए यह संदेश। जब मन हो तब जवाब दीजिए। चेक इन आप सेटिंग्स पेज से बंद कर सकते हैं।",
      "button": "चेक इन सेटिंग"
    }
  },
  /* Bengali */
  bn: {
    "serviceNameFallback": "বন্ধু",
    "sponsorNameFallback": "বন্ধু",
    "opener": {
      "withName": "{first}, আপনার অ্যাকাউন্ট নিয়ে একটা ছোট কথা, এটা আপনার স্পনসরের পাঠানো মেসেজ নয়।",
      "noName": "আপনার অ্যাকাউন্ট নিয়ে একটা ছোট কথা, এটা আপনার স্পনসরের পাঠানো মেসেজ নয়।"
    },
    "leaving": {
      "deleteOnly": "আপনার অ্যাকাউন্ট এবং তার ভেতরের সবকিছু মুছে ফেলার অনুরোধ আমরা পেয়েছি। কাজটা {when} তারিখে করা হবে।",
      "cardAndDelete": "আপনার সাবস্ক্রিপশন এখনই বাতিল করা হয়েছে, তাই আপনার কার্ড থেকে আর কোনো টাকা কাটা হবে না। আপনার অ্যাকাউন্ট এবং তার ভেতরের সবকিছু মুছে ফেলার অনুরোধও আমরা পেয়েছি, আর সেটা {when} তারিখে করা হবে।",
      "nothingYet": "এখনো কিছুই মুছে ফেলা হয়নি, আর ততদিন পর্যন্ত আপনার স্পনসর ঠিক আগের মতোই কাজ করে যাবে। ",
      "withLink": "ওই তারিখের আগে যেকোনো সময় আপনি নিজেই এটা বন্ধ করতে পারেন এখানে:\n\n{link}\n\nঅথবা শুধু এই মেসেজের উত্তর দিন, আমরা আপনার হয়ে কাজটা করে দেব। যেভাবেই হোক, আপনার কিছুই হারাবে না।",
      "noLink": "ওই তারিখের আগে যেকোনো সময় শুধু এই মেসেজের উত্তর দিন, আমরা এটা বন্ধ করে দেব, আর আপনার কিছুই হারাবে না।",
      "button": "অ্যাকাউন্ট রাখতে চাই",
      "templateBeta": "হাই {{1}}, আপনার অ্যাকাউন্ট নিয়ে একটা ছোট কথা, এটা আপনার স্পনসরের পাঠানো মেসেজ নয়। আপনার অ্যাকাউন্ট এবং তার ভেতরের সবকিছু মুছে ফেলার অনুরোধ আমরা পেয়েছি, আর সেটা {{2}} তারিখে করা হবে। এখনো কিছুই মুছে ফেলা হয়নি, আর ততদিন পর্যন্ত আপনার স্পনসর ঠিক আগের মতোই কাজ করে যাবে। ওই তারিখের আগে যেকোনো সময় নিচের বাটন দিয়ে, বা এখানে উত্তর দিয়ে আপনি এটা বন্ধ করতে পারেন।",
      "templatePaid": "হাই {{1}}, আপনার অ্যাকাউন্ট নিয়ে একটা ছোট কথা, এটা আপনার স্পনসরের পাঠানো মেসেজ নয়। আপনার সাবস্ক্রিপশন এখনই বাতিল করা হয়েছে, তাই আপনার কার্ড থেকে আর কোনো টাকা কাটা হবে না। আপনার অ্যাকাউন্ট এবং তার ভেতরের সবকিছু মুছে ফেলার অনুরোধও আমরা পেয়েছি, আর সেটা {{2}} তারিখে করা হবে। এখনো কিছুই মুছে ফেলা হয়নি, আর ততদিন পর্যন্ত আপনার স্পনসর ঠিক আগের মতোই কাজ করে যাবে। ওই তারিখের আগে যেকোনো সময় নিচের বাটন দিয়ে, বা এখানে উত্তর দিয়ে আপনি এটা বন্ধ করতে পারেন।"
    },
    "trial": {
      "body": "আপনার ৩০ দিনের ফ্রি সময় {when} তারিখে শেষ হচ্ছে, আর তারপর মাসে $5 এর প্ল্যান শুরু হবে। আপনি না চাইলে এখানেই সেটা বন্ধ করতে পারেন:\n\n{link}\n\nযেভাবেই হোক, আমার সঙ্গে আপনি আজ যেভাবে কথা বলেন, তার কিছুই বদলাচ্ছে না।",
      "button": "প্ল্যান ম্যানেজ করুন",
      "template": "হাই {{1}}, আপনার AI Sponsor অ্যাকাউন্ট নিয়ে একটা ছোট কথা, এটা আপনার স্পনসরের পাঠানো মেসেজ নয়। আপনার ৩০ দিনের ফ্রি সময় {{2}} তারিখে শেষ হচ্ছে আর তারপর মাসে $5 এর প্ল্যান শুরু হবে। যেকোনো সময় আপনি প্ল্যান বদলাতে বা বাতিল করতে পারেন।",
      "templateV2": "হাই {{1}}, আপনার ফ্রি AI Sponsor ট্রায়াল {{2}} তারিখে শেষ হচ্ছে। ওই দিন আপনার কার্ড থেকে মাসিক 5 ডলারের সাবস্ক্রিপশন কাটা হবে। ওই তারিখের আগে নিচের বাটন দিয়ে আপনি প্ল্যান বদলাতে বা বাতিল করতে পারেন। এটা অ্যাকাউন্ট সংক্রান্ত একটা খবর, আপনার স্পনসরের পাঠানো মেসেজ নয়।"
    },
    "weekly": {
      "greet": "{first}, ",
      "hard": "তোমার সপ্তাহটা নিয়ে ভাবছিলাম। তোমার জন্য কয়েকটা কথা লিখে রেখেছি, শুধু যদি তুমি চাও:\n\n{link}\n\nউত্তর দিতে হবে না। যেভাবেই হোক, আমি আছি।",
      "quiet": "আমাদের মধ্যে চুপচাপ একটা সপ্তাহ গেল, তাতে অসুবিধা নেই। তুমি চাইলে পড়তে পারো, এখানে ছোট একটা নোট রেখে দিয়েছি:\n\n{link}",
      "good": "তোমার সপ্তাহটা আমি আবার দেখলাম আর তোমার জন্য লিখে রাখলাম। যখন ইচ্ছে হবে, এখানেই পাবে:\n\n{link}",
      "button": "তোমার সপ্তাহ দেখো",
      "templates": {
        "hard": "হাই {{1}}, তোমার সপ্তাহটা নিয়ে ভাবছিলাম। তোমার জন্য কয়েকটা কথা লিখে রেখেছি, শুধু যদি তুমি চাও। উত্তর দিতে হবে না। যেভাবেই হোক, আমি আছি।",
        "quiet": "হাই {{1}}, আমাদের মধ্যে চুপচাপ একটা সপ্তাহ গেল, তাতে অসুবিধা নেই। তুমি চাইলে পড়তে পারো, ছোট একটা নোট রেখে দিয়েছি।",
        "good": "হাই {{1}}, তোমার সপ্তাহটা আমি আবার দেখলাম আর তোমার জন্য লিখে রাখলাম। যখন ইচ্ছে হবে, এখানেই পাবে।"
      },
      "privacy": "\n\nআমরা আমাদের প্রাইভেসি পলিসিও আপডেট করেছি, সেখানে লেখা আছে আমি কী রাখি আর কীভাবে তা মুছে ফেলা যায়। ওই পাতার উপরেই লিংকটা আছে।"
    },
    "weeklyReady": {
      "template": "হাই {{1}}, AI Sponsor থেকে আপনার সাপ্তাহিক নোট তৈরি হয়ে গেছে। নিচের বাটন দিয়ে নিজের অ্যাকাউন্ট পাতায় গিয়ে পড়তে পারেন।",
      "button": "আপনার সপ্তাহ দেখুন"
    },
    "quietCard": {
      "none": "এই সপ্তাহে আমাদের কথা হয়নি। সেটা চলে, আর তাতে কিছুই নষ্ট হয় না। তুমি যখন চাইবে আমি আছি, আগে বকেয়া কিছু সারতে হবে না।",
      "some": "আমাদের মধ্যে একটা চুপচাপ সপ্তাহ। এটা ব্যর্থতা নয়, আর আমি কোনো হিসেবও রাখছি না। যখন ভালো করে কথা বলতে চাইবে, আমি আছি।",
      "nextWeek": "এই সপ্তাহে আমার দিক থেকে কোনো কাজ নেই। কিছু একটা হলেই মেসেজ করো, ছোট কিছু হলেও।"
    },
    "checkin": {
      "hi": "হাই {first}, ",
      "text": "কয়েক দিন হয়ে গেল। বিশেষ কোনো কারণ নেই, শুধু দেখতে চাইলাম তুমি কেমন আছো।",
      "template": "হাই {{1}}, কয়েক দিন হয়ে গেল। বিশেষ কোনো কারণ নেই, শুধু দেখতে চাইলাম তুমি কেমন আছো।"
    },
    "checkinRequested": {
      "template": "হাই {{1}}, আপনি বলেছিলেন কয়েক দিন আপনার খবর না পেলে যেন খোঁজ নেওয়া হয়, তাই এই মেসেজ। কথা বলতে চাইলে যেকোনো সময় উত্তর দিন। সেটিংস পাতা থেকে চেক-ইন বন্ধ করা যায়।",
      "button": "চেক-ইন ম্যানেজ করুন"
    }
  },
  /* Chinese */
  zh: {
    "serviceNameFallback": "朋友",
    "sponsorNameFallback": "朋友",
    "opener": {
      "withName": "{first}，关于您的账户有一件事要说明，这不是您的辅导员发来的消息。",
      "noName": "关于您的账户有一件事要说明，这不是您的辅导员发来的消息。"
    },
    "leaving": {
      "deleteOnly": "我们已收到您删除账户及其中所有内容的请求，会在 {when} 执行。",
      "cardAndDelete": "您的订阅已立即取消，不会再从您的银行卡扣款。我们也收到了您删除账户及其中所有内容的请求，会在 {when} 执行。",
      "nothingYet": "目前还没有删除任何内容，在那之前，您的辅导员会和以往完全一样继续陪着您。 ",
      "withLink": "在那个日期之前，您随时可以自己在这里终止：\n\n{link}\n\n或者直接回复这条消息，我们帮您处理。无论哪种方式，您都不会失去任何东西。",
      "noLink": "在那个日期之前，随时回复这条消息，我们就帮您终止，您不会失去任何东西。",
      "button": "保留我的账户",
      "templateBeta": "您好，{{1}}，关于您的账户有一件事要说明，这不是您的辅导员发来的消息。我们已收到您删除账户及其中所有内容的请求，会在 {{2}} 执行。目前还没有删除任何内容，在那之前，您的辅导员会和以往完全一样继续陪着您。在那个日期之前，您随时可以点下面的按钮，或者直接回复这里，来终止删除。",
      "templatePaid": "您好，{{1}}，关于您的账户有一件事要说明，这不是您的辅导员发来的消息。您的订阅已立即取消，不会再从您的银行卡扣款。我们也收到了您删除账户及其中所有内容的请求，会在 {{2}} 执行。目前还没有删除任何内容，在那之前，您的辅导员会和以往完全一样继续陪着您。在那个日期之前，您随时可以点下面的按钮，或者直接回复这里，来终止删除。"
    },
    "trial": {
      "body": "您的 30 天免费试用将在 {when} 结束，届时每月 5 美元的方案开始生效。如果您不希望这样，可以在这里终止：\n\n{link}\n\n无论如何，您今天和我说话的方式都不会有任何变化。",
      "button": "管理我的方案",
      "template": "您好，{{1}}，关于您的 AI Sponsor 账户有一件事要说明，这不是您的辅导员发来的消息。您的 30 天免费试用将在 {{2}} 结束，届时每月 5 美元的方案开始生效。您可以随时更改或取消。",
      "templateV2": "您好，{{1}}，您的 AI Sponsor 免费试用将在 {{2}} 结束。当天会从您的银行卡收取 5 美元的月订阅费。在那个日期之前，您可以用下面的按钮更改或取消方案。这是账户通知，不是您的辅导员发来的消息。"
    },
    "weekly": {
      "greet": "{first}，",
      "hard": "我一直在想你这一周。我给你写了几句话，你想看的时候再看：\n\n{link}\n\n不用回复。我都在。",
      "quiet": "这周我们之间挺安静的，这没关系。我在这里给你留了一小段话，你想看就看：\n\n{link}",
      "good": "我回头看了看你这一周，把它写下来了。你什么时候想看，它都在这里：\n\n{link}",
      "button": "看看你的这一周",
      "templates": {
        "hard": "嘿，{{1}}，我一直在想你这一周。我给你写了几句话，你想看的时候再看。不用回复。我都在。",
        "quiet": "嘿，{{1}}，这周我们之间挺安静的，这没关系。我给你留了一小段话，你想看就看。",
        "good": "嘿，{{1}}，我回头看了看你这一周，把它写下来了。你什么时候想看，它都在这里。"
      },
      "privacy": "\n\n我们也更新了隐私政策，里面说明了我会保留哪些内容，以及怎么删除。链接在那个页面的顶部。"
    },
    "weeklyReady": {
      "template": "您好，{{1}}，您在 AI Sponsor 的每周记录已经准备好了。点下面的按钮就能在账户页面阅读。",
      "button": "看看你的这一周"
    },
    "quietCard": {
      "none": "这周我们没聊。这是可以的，也不会抹掉任何东西。你想找我的时候我就在，不用先补上什么。",
      "some": "这周我们之间挺安静的。这不是失败，我也没在记账。你什么时候想好好聊，我都在。",
      "nextWeek": "这周我不给你留任务。有什么事就来找我，哪怕是很小的事。"
    },
    "checkin": {
      "hi": "你好 {first}，",
      "text": "有几天没聊了。没什么特别的原因，我就是想看看你怎么样。",
      "template": "嘿，{{1}}，有几天没聊了。没什么特别的原因，我就是想看看你怎么样。"
    },
    "checkinRequested": {
      "template": "您好，{{1}}，您让我在几天没有联系时来问一声，所以我来了。想聊的时候随时回复。您也可以在设置页面关闭定期问候。",
      "button": "管理定期问候"
    }
  },
  /* Japanese */
  ja: {
    "serviceNameFallback": "こんにちは",
    "sponsorNameFallback": "やあ",
    "opener": {
      "withName": "{first}、アカウントに関する事務的なお知らせです。スポンサーからのメッセージではありません。",
      "noName": "アカウントに関する事務的なお知らせです。スポンサーからのメッセージではありません。"
    },
    "leaving": {
      "deleteOnly": "アカウントとその中のすべてを削除するご依頼を承りました。{when}に実行されます。",
      "cardAndDelete": "サブスクリプションはただちに解約されましたので、これ以上カードに請求されることはありません。また、アカウントとその中のすべてを削除するご依頼も承っており、{when}に実行されます。",
      "nothingYet": "まだ何も削除されていません。それまでは、スポンサーはこれまでとまったく同じように応じます。 ",
      "withLink": "その日までなら、いつでもここからご自分で取り消せます。\n\n{link}\n\nこのメッセージに返信していただければ、こちらで取り消すこともできます。どちらの場合も、失われるものは何もありません。",
      "noLink": "その日までにこのメッセージに返信していただければ、こちらで取り消します。失われるものは何もありません。",
      "button": "アカウントを残す",
      "templateBeta": "こんにちは、{{1}}さん。アカウントに関する事務的なお知らせです。スポンサーからのメッセージではありません。アカウントとその中のすべてを削除するご依頼を承っており、{{2}}に実行されます。まだ何も削除されておらず、それまではスポンサーもこれまでとまったく同じように応じます。その日までなら、下のボタン、またはこのメッセージへの返信で、いつでも取り消せます。",
      "templatePaid": "こんにちは、{{1}}さん。アカウントに関する事務的なお知らせです。スポンサーからのメッセージではありません。サブスクリプションはただちに解約されましたので、これ以上カードに請求されることはありません。また、アカウントとその中のすべてを削除するご依頼も承っており、{{2}}に実行されます。まだ何も削除されておらず、それまではスポンサーもこれまでとまったく同じように応じます。その日までなら、下のボタン、またはこのメッセージへの返信で、いつでも取り消せます。"
    },
    "trial": {
      "body": "無料の30日間は{when}に終了し、その日から月5ドルのプランが始まります。ご希望でなければ、ここから停止できます。\n\n{link}\n\nいずれにしても、今日のやり取りの仕方は何も変わりません。",
      "button": "プランを管理する",
      "template": "こんにちは、{{1}}さん。AI Sponsorのアカウントに関する事務的なお知らせです。スポンサーからのメッセージではありません。無料の30日間は{{2}}に終了し、その日から月5ドルのプランが始まります。変更や解約はいつでもできます。",
      "templateV2": "こんにちは、{{1}}さん。無料のAI Sponsorお試し期間は{{2}}に終了します。その日に月額5ドルのサブスクリプション料金がカードに請求されます。その日より前に、下のボタンからプランの変更や解約ができます。これはアカウントに関するお知らせで、スポンサーからのメッセージではありません。"
    },
    "weekly": {
      "greet": "{first}、",
      "hard": "今週のことをずっと考えていたよ。よかったら読んでほしくて、いくつか書きとめておいた。\n\n{link}\n\n返信はいらないよ。どちらにしても、私はここにいるからね。",
      "quiet": "今週はお互い静かだったね。それでいいんだよ。よかったら読んでほしい短いメモを、ここに置いておいた。\n\n{link}",
      "good": "今週を振り返って、書きとめておいたよ。読みたくなったら、いつでもここにあるからね。\n\n{link}",
      "button": "今週のふりかえり",
      "templates": {
        "hard": "やあ、{{1}}さん、今週のことをずっと考えていたよ。よかったら読んでほしくて、いくつか書きとめておいた。返信はいらないよ。どちらにしても、私はここにいるからね。",
        "quiet": "やあ、{{1}}さん、今週はお互い静かだったね。それでいいんだよ。よかったら読んでほしい短いメモを置いておいた。",
        "good": "やあ、{{1}}さん、今週を振り返って、書きとめておいたよ。読みたくなったら、いつでもここにあるからね。"
      },
      "privacy": "\n\nプライバシーポリシーも更新しました。私が何を保存するのか、どうすれば削除できるのかが書いてあります。そのページの上部にリンクがあります。"
    },
    "weeklyReady": {
      "template": "こんにちは、{{1}}さん。AI Sponsorからの今週のメモが用意できました。下のボタンから、アカウントページでお読みいただけます。",
      "button": "今週のふりかえり"
    },
    "quietCard": {
      "none": "今週は話さなかったね。それでいいんだよ。これまでのことが消えるわけじゃない。話したくなったらいつでもここにいるし、その前に何か追いつく必要もないから。",
      "some": "今週はお互い静かだったね。失敗じゃないし、点数をつけてもいないよ。ちゃんと話したくなったら、いつでもここにいる。",
      "nextWeek": "今週、私から出す課題はないよ。何か出てきたら、小さなことでもメッセージして。"
    },
    "checkin": {
      "hi": "{first}、",
      "text": "何日か経ったね。特に理由はないんだけど、どうしているかなと思って。",
      "template": "やあ、{{1}}さん、何日か経ったね。特に理由はないんだけど、どうしているかなと思って。"
    },
    "checkinRequested": {
      "template": "こんにちは、{{1}}さん。数日連絡がなかったら声をかけてほしいとのことでしたので、こうしてお送りしています。話したくなったら、いつでも返信してください。声かけは設定ページでオフにできます。",
      "button": "声かけの設定"
    }
  },
  /* Korean */
  ko: {
    "serviceNameFallback": "회원님",
    "sponsorNameFallback": "친구",
    "opener": {
      "withName": "{first}님, 계정 관련 간단한 안내입니다. 스폰서가 보내는 메시지가 아닙니다.",
      "noName": "계정 관련 간단한 안내입니다. 스폰서가 보내는 메시지가 아닙니다."
    },
    "leaving": {
      "deleteOnly": "계정과 그 안의 모든 내용을 삭제해 달라는 요청을 접수했습니다. {when}에 처리됩니다.",
      "cardAndDelete": "구독은 즉시 해지되어 카드에서 더 이상 결제되지 않습니다. 계정과 그 안의 모든 내용을 삭제해 달라는 요청도 접수했으며, {when}에 처리됩니다.",
      "nothingYet": "아직 삭제된 것은 없고, 그때까지 스폰서는 지금과 똑같이 함께합니다. ",
      "withLink": "그 날짜 전이라면 언제든 여기서 직접 취소하실 수 있습니다:\n\n{link}\n\n또는 이 메시지에 답장만 주시면 저희가 처리해 드립니다. 어느 쪽이든 잃는 것은 없습니다.",
      "noLink": "그 날짜 전에 이 메시지로 답장만 주시면 저희가 중단해 드립니다. 잃는 것은 없습니다.",
      "button": "계정 유지하기",
      "templateBeta": "안녕하세요, {{1}}님. 계정 관련 간단한 안내입니다. 스폰서가 보내는 메시지가 아닙니다. 계정과 그 안의 모든 내용을 삭제해 달라는 요청을 접수했으며, {{2}}에 처리됩니다. 아직 삭제된 것은 없고 그때까지 스폰서는 지금과 똑같이 함께합니다. 그 날짜 전이라면 아래 버튼으로, 또는 여기에 답장으로 언제든 취소하실 수 있습니다.",
      "templatePaid": "안녕하세요, {{1}}님. 계정 관련 간단한 안내입니다. 스폰서가 보내는 메시지가 아닙니다. 구독은 즉시 해지되어 카드에서 더 이상 결제되지 않습니다. 계정과 그 안의 모든 내용을 삭제해 달라는 요청도 접수했으며, {{2}}에 처리됩니다. 아직 삭제된 것은 없고 그때까지 스폰서는 지금과 똑같이 함께합니다. 그 날짜 전이라면 아래 버튼으로, 또는 여기에 답장으로 언제든 취소하실 수 있습니다."
    },
    "trial": {
      "body": "무료 30일이 {when}에 끝나고, 그때부터 월 5달러 요금제가 시작됩니다. 원하지 않으시면 여기서 중단하실 수 있습니다:\n\n{link}\n\n어느 쪽이든 오늘 저와 이야기하는 방식은 달라지지 않습니다.",
      "button": "요금제 관리",
      "template": "안녕하세요, {{1}}님. AI Sponsor 계정 관련 간단한 안내입니다. 스폰서가 보내는 메시지가 아닙니다. 무료 30일이 {{2}}에 끝나고 그때부터 월 5달러 요금제가 시작됩니다. 언제든 변경하거나 해지하실 수 있습니다.",
      "templateV2": "안녕하세요, {{1}}님. AI Sponsor 무료 체험이 {{2}}에 끝납니다. 그날 월 5달러 구독료가 카드에서 결제됩니다. 그 전에 아래 버튼으로 요금제를 변경하거나 해지하실 수 있습니다. 이것은 계정 안내이며, 스폰서가 보내는 메시지가 아닙니다."
    },
    "weekly": {
      "greet": "{first}님, ",
      "hard": "이번 주 생각 많이 했어요. 몇 가지 적어 뒀는데, 보고 싶을 때만 보면 돼요:\n\n{link}\n\n답장은 안 해도 괜찮아요. 어느 쪽이든 저는 여기 있어요.",
      "quiet": "이번 주는 우리 사이가 조용했네요. 그래도 괜찮아요. 짧게 메모 하나 남겨 뒀으니 원하면 봐요:\n\n{link}",
      "good": "이번 주를 돌아보면서 적어 뒀어요. 보고 싶을 때 언제든 여기 있어요:\n\n{link}",
      "button": "이번 주 보기",
      "templates": {
        "hard": "안녕하세요, {{1}}님. 이번 주 생각 많이 했어요. 몇 가지 적어 뒀는데, 보고 싶을 때만 보면 돼요. 답장은 안 해도 괜찮아요. 어느 쪽이든 저는 여기 있어요.",
        "quiet": "안녕하세요, {{1}}님. 이번 주는 우리 사이가 조용했네요. 그래도 괜찮아요. 짧게 메모 하나 남겨 뒀으니 원하면 봐요.",
        "good": "안녕하세요, {{1}}님. 이번 주를 돌아보면서 적어 뒀어요. 보고 싶을 때 언제든 여기 있어요."
      },
      "privacy": "\n\n개인정보 처리방침도 업데이트했어요. 제가 무엇을 보관하고 어떻게 삭제하는지 적혀 있어요. 그 페이지 맨 위에 링크가 있어요."
    },
    "weeklyReady": {
      "template": "안녕하세요, {{1}}님. AI Sponsor의 주간 메모가 준비됐습니다. 아래 버튼을 눌러 계정 페이지에서 읽어 보실 수 있습니다.",
      "button": "이번 주 보기"
    },
    "quietCard": {
      "none": "이번 주에는 우리가 이야기를 못 했네요. 그래도 괜찮고, 그게 뭘 되돌리는 것도 아니에요. 원할 때 저는 여기 있고, 먼저 따라잡아야 할 것도 없어요.",
      "some": "우리 사이가 조용한 한 주였네요. 그건 실패가 아니고, 저는 점수를 매기지 않아요. 제대로 이야기하고 싶어지면 언제든 저는 여기 있어요.",
      "nextWeek": "이번 주에 제가 주는 과제는 없어요. 뭔가 생기면, 작은 일이라도 그냥 메시지 줘요."
    },
    "checkin": {
      "hi": "{first}님, ",
      "text": "며칠 지났네요. 특별한 이유는 없고, 그냥 어떻게 지내는지 보고 싶었어요.",
      "template": "안녕하세요, {{1}}님. 며칠 지났네요. 특별한 이유는 없고, 그냥 어떻게 지내는지 보고 싶었어요."
    },
    "checkinRequested": {
      "template": "안녕하세요, {{1}}님. 며칠 동안 연락이 없으면 안부를 물어 달라고 하셔서 이렇게 연락드립니다. 이야기하고 싶을 때 언제든 답장해 주세요. 안부 확인은 설정 페이지에서 끄실 수 있습니다.",
      "button": "안부 확인 관리"
    }
  },
  /* Indonesian */
  id: {
    "serviceNameFallback": "Sahabat",
    "sponsorNameFallback": "Sahabat",
    "opener": {
      "withName": "{first}, ada info singkat tentang akun Anda, bukan pesan dari sponsor Anda.",
      "noName": "Ada info singkat tentang akun Anda, bukan pesan dari sponsor Anda."
    },
    "leaving": {
      "deleteOnly": "Kami sudah menerima permintaan Anda untuk menghapus akun dan semua isinya. Penghapusan akan dilakukan pada {when}.",
      "cardAndDelete": "Langganan Anda langsung dibatalkan, jadi tidak ada lagi yang ditagih dari kartu Anda. Kami juga sudah menerima permintaan Anda untuk menghapus akun dan semua isinya, dan itu akan dilakukan pada {when}.",
      "nothingYet": "Belum ada yang dihapus, dan sponsor Anda tetap bekerja seperti biasa sampai saat itu. ",
      "withLink": "Anda bisa membatalkannya sendiri di sini, kapan saja sebelum tanggal itu:\n\n{link}\n\nAtau cukup balas pesan ini dan kami akan melakukannya untuk Anda. Dengan cara mana pun, Anda tidak kehilangan apa pun.",
      "noLink": "Cukup balas pesan ini kapan saja sebelum tanggal itu dan kami akan membatalkannya, dan Anda tidak kehilangan apa pun.",
      "button": "Pertahankan akun saya",
      "templateBeta": "Hai {{1}}, ada info singkat tentang akun Anda, bukan pesan dari sponsor Anda. Kami sudah menerima permintaan Anda untuk menghapus akun dan semua isinya, dan itu akan dilakukan pada {{2}}. Belum ada yang dihapus dan sponsor Anda tetap bekerja seperti biasa sampai saat itu. Anda bisa membatalkannya dengan tombol di bawah, atau dengan membalas pesan ini, kapan saja sebelum tanggal itu.",
      "templatePaid": "Hai {{1}}, ada info singkat tentang akun Anda, bukan pesan dari sponsor Anda. Langganan Anda langsung dibatalkan, jadi tidak ada lagi yang ditagih dari kartu Anda. Kami juga sudah menerima permintaan Anda untuk menghapus akun dan semua isinya, dan itu akan dilakukan pada {{2}}. Belum ada yang dihapus dan sponsor Anda tetap bekerja seperti biasa sampai saat itu. Anda bisa membatalkannya dengan tombol di bawah, atau dengan membalas pesan ini, kapan saja sebelum tanggal itu."
    },
    "trial": {
      "body": "Masa gratis 30 hari Anda berakhir pada {when}, dan paket $5 per bulan mulai berlaku saat itu. Kalau Anda tidak ingin melanjutkan, Anda bisa membatalkannya di sini:\n\n{link}\n\nApa pun pilihan Anda, tidak ada yang berubah dalam cara Anda berbicara dengan saya hari ini.",
      "button": "Kelola paket saya",
      "template": "Hai {{1}}, ada info singkat tentang akun AI Sponsor Anda, bukan pesan dari sponsor Anda. Masa gratis 30 hari Anda berakhir pada {{2}} dan paket $5 per bulan mulai berlaku saat itu. Anda bisa mengubah atau membatalkannya kapan saja.",
      "templateV2": "Hai {{1}}, masa uji coba gratis AI Sponsor Anda berakhir pada {{2}}. Pada hari itu langganan bulanan 5 USD akan ditagihkan ke kartu Anda. Anda bisa mengubah atau membatalkan paket sebelum tanggal itu dengan tombol di bawah. Ini pemberitahuan akun, bukan pesan dari sponsor Anda."
    },
    "weekly": {
      "greet": "{first}, ",
      "hard": "aku memikirkan pekanmu. Aku menuliskan beberapa hal untukmu, kalau kamu mau membacanya:\n\n{link}\n\nTidak perlu dibalas. Aku tetap di sini.",
      "quiet": "pekan yang sepi di antara kita, dan itu tidak masalah. Aku meninggalkan catatan singkat di sini kalau kamu mau:\n\n{link}",
      "good": "aku melihat kembali pekanmu dan menuliskannya untukmu. Ada di sini kapan pun kamu mau:\n\n{link}",
      "button": "Lihat pekanmu",
      "templates": {
        "hard": "Hai {{1}}, aku memikirkan pekanmu. Aku menuliskan beberapa hal untukmu, kalau kamu mau membacanya. Tidak perlu dibalas. Aku tetap di sini.",
        "quiet": "Hai {{1}}, pekan yang sepi di antara kita, dan itu tidak masalah. Aku meninggalkan catatan singkat kalau kamu mau.",
        "good": "Hai {{1}}, aku melihat kembali pekanmu dan menuliskannya untukmu. Ada di sini kapan pun kamu mau."
      },
      "privacy": "\n\nKami juga sudah memperbarui kebijakan privasi, yang menjelaskan apa yang aku simpan dan cara menghapusnya. Tautannya ada di bagian atas halaman itu."
    },
    "weeklyReady": {
      "template": "Hai {{1}}, catatan pekanan Anda dari AI Sponsor sudah siap. Anda bisa membacanya di halaman akun dengan tombol di bawah.",
      "button": "Lihat catatan Anda"
    },
    "quietCard": {
      "none": "Pekan ini kita tidak bicara. Itu boleh, dan itu tidak menghapus apa pun. Aku di sini kapan pun kamu mau, dan tidak ada yang perlu dikejar dulu.",
      "some": "Pekan yang sepi di antara kita. Itu bukan kegagalan dan aku tidak menghitung-hitung. Kapan pun kamu ingin bicara sungguhan, aku di sini.",
      "nextWeek": "Tidak ada tugas dariku pekan ini. Cukup kirim pesan kalau ada sesuatu, sekecil apa pun."
    },
    "checkin": {
      "hi": "Hai {first}, ",
      "text": "sudah beberapa hari ini. Tidak ada alasan khusus, aku hanya ingin tahu kabarmu.",
      "template": "Hai {{1}}, sudah beberapa hari ini. Tidak ada alasan khusus, aku hanya ingin tahu kabarmu."
    },
    "checkinRequested": {
      "template": "Hai {{1}}, Anda meminta kami menyapa kalau beberapa hari tidak ada kabar dari Anda, jadi ini pesannya. Balas kapan pun Anda ingin bicara. Anda bisa mematikan sapaan berkala di halaman pengaturan.",
      "button": "Atur sapaan berkala"
    }
  },
  /* Vietnamese */
  vi: {
    "serviceNameFallback": "bạn",
    "sponsorNameFallback": "bạn",
    "opener": {
      "withName": "{first}, đây là thông báo ngắn về tài khoản của bạn, không phải tin nhắn từ người bảo trợ của bạn.",
      "noName": "Đây là thông báo ngắn về tài khoản của bạn, không phải tin nhắn từ người bảo trợ của bạn."
    },
    "leaving": {
      "deleteOnly": "Chúng tôi đã nhận được yêu cầu xoá tài khoản và toàn bộ dữ liệu trong đó của bạn. Việc này sẽ được thực hiện vào {when}.",
      "cardAndDelete": "Đăng ký của bạn được huỷ ngay lập tức, nên thẻ của bạn sẽ không bị trừ thêm khoản nào nữa. Chúng tôi cũng đã nhận được yêu cầu xoá tài khoản và toàn bộ dữ liệu trong đó, và việc này sẽ được thực hiện vào {when}.",
      "nothingYet": "Hiện chưa có gì bị xoá, và từ giờ đến lúc đó người bảo trợ của bạn vẫn làm việc đúng như trước. ",
      "withLink": "Bạn có thể tự dừng việc này tại đây, bất cứ lúc nào trước ngày đó:\n\n{link}\n\nHoặc chỉ cần trả lời tin nhắn này và chúng tôi sẽ làm giúp bạn. Dù cách nào, bạn cũng không mất gì cả.",
      "noLink": "Chỉ cần trả lời tin nhắn này bất cứ lúc nào trước ngày đó và chúng tôi sẽ dừng lại, bạn sẽ không mất gì cả.",
      "button": "Giữ tài khoản của tôi",
      "templateBeta": "Chào {{1}}, đây là thông báo ngắn về tài khoản của bạn, không phải tin nhắn từ người bảo trợ của bạn. Chúng tôi đã nhận được yêu cầu xoá tài khoản và toàn bộ dữ liệu trong đó, và việc này sẽ được thực hiện vào {{2}}. Hiện chưa có gì bị xoá và từ giờ đến lúc đó người bảo trợ của bạn vẫn làm việc đúng như trước. Bạn có thể dừng việc này bằng nút bên dưới, hoặc trả lời ngay tại đây, bất cứ lúc nào trước ngày đó.",
      "templatePaid": "Chào {{1}}, đây là thông báo ngắn về tài khoản của bạn, không phải tin nhắn từ người bảo trợ của bạn. Đăng ký của bạn được huỷ ngay lập tức, nên thẻ của bạn sẽ không bị trừ thêm khoản nào nữa. Chúng tôi cũng đã nhận được yêu cầu xoá tài khoản và toàn bộ dữ liệu trong đó, và việc này sẽ được thực hiện vào {{2}}. Hiện chưa có gì bị xoá và từ giờ đến lúc đó người bảo trợ của bạn vẫn làm việc đúng như trước. Bạn có thể dừng việc này bằng nút bên dưới, hoặc trả lời ngay tại đây, bất cứ lúc nào trước ngày đó."
    },
    "trial": {
      "body": "30 ngày miễn phí của bạn kết thúc vào {when}, và gói 5 USD một tháng sẽ bắt đầu từ lúc đó. Nếu bạn không muốn vậy, bạn có thể dừng tại đây:\n\n{link}\n\nDù thế nào, cách bạn trò chuyện với tôi hôm nay cũng không có gì thay đổi.",
      "button": "Quản lý gói của tôi",
      "template": "Chào {{1}}, đây là thông báo ngắn về tài khoản AI Sponsor của bạn, không phải tin nhắn từ người bảo trợ của bạn. 30 ngày miễn phí của bạn kết thúc vào {{2}} và gói 5 USD mỗi tháng sẽ bắt đầu từ lúc đó. Bạn có thể thay đổi hoặc huỷ bất cứ lúc nào.",
      "templateV2": "Chào {{1}}, bản dùng thử miễn phí AI Sponsor của bạn kết thúc vào {{2}}. Vào ngày đó, thẻ của bạn sẽ bị trừ phí đăng ký 5 USD mỗi tháng. Bạn có thể thay đổi hoặc huỷ gói trước ngày đó bằng nút bên dưới. Đây là thông báo về tài khoản, không phải tin nhắn từ người bảo trợ của bạn."
    },
    "weekly": {
      "greet": "{first}, ",
      "hard": "mình vẫn nghĩ về tuần vừa rồi của bạn. Mình có ghi lại vài điều cho bạn, chỉ khi nào bạn muốn đọc thôi:\n\n{link}\n\nKhông cần trả lời. Dù sao mình cũng ở đây.",
      "quiet": "một tuần yên lặng giữa hai chúng ta, cũng không sao. Mình để lại cho bạn một ghi chú ngắn ở đây nếu bạn muốn đọc:\n\n{link}",
      "good": "mình đã đọc lại tuần vừa rồi của bạn và ghi lại cho bạn. Nó ở đây, bất cứ khi nào bạn muốn:\n\n{link}",
      "button": "Xem tuần của bạn",
      "templates": {
        "hard": "Chào {{1}}, mình vẫn nghĩ về tuần vừa rồi của bạn. Mình có ghi lại vài điều cho bạn, chỉ khi nào bạn muốn đọc thôi. Không cần trả lời. Dù sao mình cũng ở đây.",
        "quiet": "Chào {{1}}, một tuần yên lặng giữa hai chúng ta, cũng không sao. Mình để lại cho bạn một ghi chú ngắn nếu bạn muốn đọc.",
        "good": "Chào {{1}}, mình đã đọc lại tuần vừa rồi của bạn và ghi lại cho bạn. Nó ở đây, bất cứ khi nào bạn muốn."
      },
      "privacy": "\n\nChúng tôi cũng đã cập nhật chính sách bảo mật, trong đó giải thích mình lưu lại những gì và cách xoá chúng. Liên kết nằm ở đầu trang đó."
    },
    "weeklyReady": {
      "template": "Chào {{1}}, ghi chú tuần này từ AI Sponsor của bạn đã sẵn sàng. Bạn có thể đọc trên trang tài khoản của mình bằng nút bên dưới.",
      "button": "Xem tuần của bạn"
    },
    "quietCard": {
      "none": "Tuần này chúng ta không nói chuyện. Điều đó không sao cả, và nó cũng không làm mất đi điều gì. Mình ở đây khi nào bạn cần, và không có gì phải bù lại trước đâu.",
      "some": "Một tuần yên lặng giữa hai chúng ta. Đó không phải là thất bại và mình cũng không tính đếm gì. Khi nào bạn muốn nói chuyện cho kỹ, mình vẫn ở đây.",
      "nextWeek": "Tuần này mình không giao việc gì cho bạn. Chỉ cần nhắn cho mình khi có chuyện gì, dù là chuyện nhỏ."
    },
    "checkin": {
      "hi": "Chào {first}, ",
      "text": "đã mấy ngày rồi. Không có lý do gì đặc biệt, mình chỉ muốn xem bạn thế nào.",
      "template": "Chào {{1}}, đã mấy ngày rồi. Không có lý do gì đặc biệt, mình chỉ muốn xem bạn thế nào."
    },
    "checkinRequested": {
      "template": "Chào {{1}}, bạn đã yêu cầu được hỏi thăm nếu vài ngày không có tin nhắn từ bạn, nên đây là tin nhắn hỏi thăm. Bạn có thể trả lời bất cứ lúc nào bạn muốn nói chuyện. Bạn có thể tắt hỏi thăm ở trang cài đặt.",
      "button": "Quản lý hỏi thăm"
    }
  },
};

/* {first} → the name, {when} → the date, {link} → the url. One shape in, the
   same shape out as the six languages written by hand. */
const fill = (s, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{${k}}`).join(v), s);

const OPENER = {};
const LEAVING = {};
const TRIAL = {};
const WEEKLY = {};
const WEEKLY_READY = {};
const QUIET_CARD = {};
const CHECKIN = {};
const CHECKIN_REQUESTED = {};
const SERVICE_NAME_FALLBACK = {};
const SPONSOR_NAME_FALLBACK = {};

for (const [lang, c] of Object.entries(DATA)) {
  SERVICE_NAME_FALLBACK[lang] = c.serviceNameFallback;
  SPONSOR_NAME_FALLBACK[lang] = c.sponsorNameFallback;
  OPENER[lang] = (first) => (first ? fill(c.opener.withName, { first }) : c.opener.noName);
  LEAVING[lang] = {
    deleteOnly: (when) => fill(c.leaving.deleteOnly, { when }),
    cardAndDelete: (when) => fill(c.leaving.cardAndDelete, { when }),
    nothingYet: c.leaving.nothingYet,
    withLink: (link) => fill(c.leaving.withLink, { link }),
    noLink: c.leaving.noLink,
    button: c.leaving.button,
    templateBeta: c.leaving.templateBeta,
    templatePaid: c.leaving.templatePaid,
  };
  TRIAL[lang] = {
    body: (when, link) => fill(c.trial.body, { when, link }),
    button: c.trial.button,
    template: c.trial.template,
    templateV2: c.trial.templateV2,
  };
  WEEKLY[lang] = {
    greet: (first) => fill(c.weekly.greet, { first }),
    hard: (link) => fill(c.weekly.hard, { link }),
    quiet: (link) => fill(c.weekly.quiet, { link }),
    good: (link) => fill(c.weekly.good, { link }),
    button: c.weekly.button,
    templates: c.weekly.templates,
    privacy: c.weekly.privacy,
  };
  WEEKLY_READY[lang] = c.weeklyReady;
  QUIET_CARD[lang] = c.quietCard;
  CHECKIN[lang] = {
    hi: (first) => fill(c.checkin.hi, { first }),
    text: c.checkin.text,
    template: c.checkin.template,
  };
  CHECKIN_REQUESTED[lang] = c.checkinRequested;
}

module.exports = {
  LANGUAGES: Object.keys(DATA),
  SERVICE_NAME_FALLBACK, SPONSOR_NAME_FALLBACK,
  OPENER, LEAVING, TRIAL, WEEKLY, WEEKLY_READY, QUIET_CARD, CHECKIN, CHECKIN_REQUESTED,
};
