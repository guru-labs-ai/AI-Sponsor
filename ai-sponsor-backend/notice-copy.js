/* ─── Automatic messages, in the other languages ─────────────────────────────
   Mariam, Sep 15: Spanish, French, German, Italian, Portuguese and Russian.
   English stays where it always was, beside the code that sends it
   (notices.js, trialnotice.js, weekly.js, checkin.js); this file only holds the
   translations, so they can be read and checked in one place.

   Two voices, same as the English:
   - SERVICE notices (trial ending, leaving) say plainly they are not the
     sponsor. Formal register in French (vous) and Russian (вы); informal in
     Spanish (tú), Italian (tu), Portuguese (você) and German (du).
   - SPONSOR messages (weekly note, check-in) are the sponsor talking, so they
     are informal in every language. Russian avoids first-person past tense,
     because it is gendered and the sponsor has no gender.

   "Sponsor" is padrino, parrain and padrinho in Spanish, French and
   Portuguese, and sponsor / спонсор in German, Italian and Russian. Worth a
   native speaker in recovery reading these before they go to Meta.

   ⚠️ templateText must match what Meta approved for that language, word for
   word. Change one, edit the other through Meta's API (never delete and
   recreate a template, see notices.js).

   Meta will not accept an empty variable, so each language has the words that
   stand in for a missing first name, chosen to read naturally after the
   greeting: "Hola a ti", "Bonjour à vous", "Hallo du", "Здравствуйте, это
   AI Sponsor". */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* What stands in for {{1}} when somebody never gave a name. */
const SERVICE_NAME_FALLBACK = { en: 'there', es: 'a ti', fr: 'à vous', de: 'du', it: 'a te', pt: 'a você', ru: 'это AI Sponsor' };
const SPONSOR_NAME_FALLBACK = { en: 'there', es: 'a ti', fr: 'toi', de: 'du', it: 'a te', pt: 'você', ru: 'друг' };

/* ── Service notices: the opener ─────────────────────────────────────────── */
const OPENER = {
  es: (first) => `${first ? `${first}, u` : 'U'}na nota rápida sobre tu cuenta, no es un mensaje de tu padrino.`,
  fr: (first) => `${first ? `Bonjour ${first}, p` : 'Bonjour, p'}etit message au sujet de votre compte, ce n'est pas votre parrain qui vous écrit.`,
  de: (first) => `${first ? `${first}, k` : 'K'}urze Info zu deinem Konto, keine Nachricht von deinem Sponsor.`,
  it: (first) => `${first ? `${first}, u` : 'U'}na breve nota sul tuo account, non è un messaggio del tuo sponsor.`,
  pt: (first) => `${first ? `${first}, u` : 'U'}m aviso rápido sobre a sua conta, não é uma mensagem do seu padrinho.`,
  ru: (first) => `${first ? `Здравствуйте, ${first}. ` : 'Здравствуйте. '}Короткое сообщение о вашем аккаунте, это пишет не ваш спонсор.`,
};

/* ── Leaving: the shared middle and end ─────────────────────────────────────
   Each language: the delete sentence, "nothing removed yet", and the two
   endings (with a link / without one), mirroring notices.js. */
const LEAVING = {
  es: {
    deleteOnly: (when) => `Hemos recibido tu solicitud para eliminar tu cuenta y todo lo que contiene. Se hará el ${when}.`,
    cardAndDelete: (when) => 'Tu suscripción queda cancelada de inmediato, así que no se te cobrará nada más en tu tarjeta. '
      + `También hemos recibido tu solicitud para eliminar tu cuenta y todo lo que contiene, y se hará el ${when}.`,
    nothingYet: 'Todavía no se ha borrado nada, y tu padrino sigue funcionando exactamente igual hasta entonces. ',
    withLink: (link) => `Puedes detenerlo aquí, en cualquier momento antes de esa fecha:\n\n${link}\n\n`
      + 'O simplemente responde a este mensaje y lo haremos por ti. En cualquier caso, no habrás perdido nada.',
    noLink: 'Solo responde a este mensaje en cualquier momento antes de esa fecha y lo detendremos, y no habrás perdido nada.',
    button: 'Mantener mi cuenta',
    templateBeta: 'Hola {{1}}, una nota rápida sobre tu cuenta, no es un mensaje de tu padrino. '
      + 'Hemos recibido tu solicitud para eliminar tu cuenta y todo lo que contiene, y se hará el {{2}}. '
      + 'Todavía no se ha borrado nada y tu padrino sigue funcionando exactamente igual hasta entonces. '
      + 'Puedes detenerlo con el botón de abajo, o respondiendo aquí, en cualquier momento antes de esa fecha.',
    templatePaid: 'Hola {{1}}, una nota rápida sobre tu cuenta, no es un mensaje de tu padrino. '
      + 'Tu suscripción queda cancelada de inmediato, así que no se te cobrará nada más en tu tarjeta. '
      + 'También hemos recibido tu solicitud para eliminar tu cuenta y todo lo que contiene, y se hará el {{2}}. '
      + 'Todavía no se ha borrado nada y tu padrino sigue funcionando exactamente igual hasta entonces. '
      + 'Puedes detenerlo con el botón de abajo, o respondiendo aquí, en cualquier momento antes de esa fecha.',
  },
  fr: {
    deleteOnly: (when) => `Nous avons bien reçu votre demande de suppression de votre compte et de tout son contenu. Elle sera effectuée le ${when}.`,
    cardAndDelete: (when) => 'Votre abonnement est résilié immédiatement, aucun autre montant ne sera prélevé sur votre carte. '
      + `Nous avons aussi bien reçu votre demande de suppression de votre compte et de tout son contenu, qui sera effectuée le ${when}.`,
    nothingYet: "Rien n'a encore été supprimé, et votre parrain continue de fonctionner exactement comme avant jusque-là. ",
    withLink: (link) => `Vous pouvez l'annuler vous-même ici, à tout moment avant cette date :\n\n${link}\n\n`
      + "Ou répondez simplement à ce message et nous le ferons pour vous. Dans les deux cas, vous n'aurez rien perdu.",
    noLink: "Répondez simplement à ce message à tout moment avant cette date et nous l'annulerons, sans que vous ayez rien perdu.",
    button: 'Garder mon compte',
    templateBeta: "Bonjour {{1}}, petit message au sujet de votre compte, ce n'est pas votre parrain qui vous écrit. "
      + 'Nous avons bien reçu votre demande de suppression de votre compte et de tout son contenu, qui sera effectuée le {{2}}. '
      + "Rien n'a encore été supprimé et votre parrain continue de fonctionner exactement comme avant jusque-là. "
      + "Vous pouvez l'annuler avec le bouton ci-dessous, ou en répondant ici, à tout moment avant cette date.",
    templatePaid: "Bonjour {{1}}, petit message au sujet de votre compte, ce n'est pas votre parrain qui vous écrit. "
      + 'Votre abonnement est résilié immédiatement, aucun autre montant ne sera prélevé sur votre carte. '
      + 'Nous avons aussi bien reçu votre demande de suppression de votre compte et de tout son contenu, qui sera effectuée le {{2}}. '
      + "Rien n'a encore été supprimé et votre parrain continue de fonctionner exactement comme avant jusque-là. "
      + "Vous pouvez l'annuler avec le bouton ci-dessous, ou en répondant ici, à tout moment avant cette date.",
  },
  de: {
    deleteOnly: (when) => `Wir haben deine Anfrage erhalten, dein Konto und alles darin zu löschen. Das passiert am ${when}.`,
    cardAndDelete: (when) => 'Dein Abo ist ab sofort gekündigt, es wird also nichts mehr von deiner Karte abgebucht. '
      + `Außerdem haben wir deine Anfrage erhalten, dein Konto und alles darin zu löschen, und das passiert am ${when}.`,
    nothingYet: 'Bisher wurde nichts entfernt, und dein Sponsor funktioniert bis dahin genau wie vorher. ',
    withLink: (link) => `Du kannst das hier jederzeit vor diesem Datum selbst stoppen:\n\n${link}\n\n`
      + 'Oder antworte einfach auf diese Nachricht, dann erledigen wir das für dich. So oder so hast du nichts verloren.',
    noLink: 'Antworte einfach jederzeit vor diesem Datum auf diese Nachricht, dann stoppen wir es, und du hast nichts verloren.',
    button: 'Konto behalten',
    templateBeta: 'Hallo {{1}}, kurze Info zu deinem Konto, keine Nachricht von deinem Sponsor. '
      + 'Wir haben deine Anfrage erhalten, dein Konto und alles darin zu löschen, und das passiert am {{2}}. '
      + 'Bisher wurde nichts entfernt und dein Sponsor funktioniert bis dahin genau wie vorher. '
      + 'Du kannst das mit dem Button unten oder mit einer Antwort hier jederzeit vor diesem Datum stoppen.',
    templatePaid: 'Hallo {{1}}, kurze Info zu deinem Konto, keine Nachricht von deinem Sponsor. '
      + 'Dein Abo ist ab sofort gekündigt, es wird also nichts mehr von deiner Karte abgebucht. '
      + 'Außerdem haben wir deine Anfrage erhalten, dein Konto und alles darin zu löschen, und das passiert am {{2}}. '
      + 'Bisher wurde nichts entfernt und dein Sponsor funktioniert bis dahin genau wie vorher. '
      + 'Du kannst das mit dem Button unten oder mit einer Antwort hier jederzeit vor diesem Datum stoppen.',
  },
  it: {
    deleteOnly: (when) => `Abbiamo ricevuto la tua richiesta di eliminare il tuo account e tutto ciò che contiene. Verrà fatto il ${when}.`,
    cardAndDelete: (when) => 'Il tuo abbonamento è annullato subito, quindi non ti verrà addebitato più nulla sulla carta. '
      + `Abbiamo anche ricevuto la tua richiesta di eliminare il tuo account e tutto ciò che contiene, e verrà fatto il ${when}.`,
    nothingYet: 'Non è stato ancora rimosso nulla e il tuo sponsor continua a funzionare esattamente come prima fino ad allora. ',
    withLink: (link) => `Puoi fermarlo da qui, in qualsiasi momento prima di quella data:\n\n${link}\n\n`
      + 'Oppure rispondi semplicemente a questo messaggio e lo faremo noi per te. In ogni caso, non avrai perso nulla.',
    noLink: 'Rispondi semplicemente a questo messaggio in qualsiasi momento prima di quella data e lo fermeremo, senza che tu perda nulla.',
    button: 'Mantieni il mio account',
    templateBeta: 'Ciao {{1}}, una breve nota sul tuo account, non è un messaggio del tuo sponsor. '
      + 'Abbiamo ricevuto la tua richiesta di eliminare il tuo account e tutto ciò che contiene, e verrà fatto il {{2}}. '
      + 'Non è stato ancora rimosso nulla e il tuo sponsor continua a funzionare esattamente come prima fino ad allora. '
      + 'Puoi fermarlo con il pulsante qui sotto, o rispondendo qui, in qualsiasi momento prima di quella data.',
    templatePaid: 'Ciao {{1}}, una breve nota sul tuo account, non è un messaggio del tuo sponsor. '
      + 'Il tuo abbonamento è annullato subito, quindi non ti verrà addebitato più nulla sulla carta. '
      + 'Abbiamo anche ricevuto la tua richiesta di eliminare il tuo account e tutto ciò che contiene, e verrà fatto il {{2}}. '
      + 'Non è stato ancora rimosso nulla e il tuo sponsor continua a funzionare esattamente come prima fino ad allora. '
      + 'Puoi fermarlo con il pulsante qui sotto, o rispondendo qui, in qualsiasi momento prima di quella data.',
  },
  pt: {
    deleteOnly: (when) => `Recebemos o seu pedido para excluir a sua conta e tudo o que há nela. Isso será feito em ${when}.`,
    cardAndDelete: (when) => 'Sua assinatura foi cancelada na hora, então nada mais será cobrado no seu cartão. '
      + `Também recebemos o seu pedido para excluir a sua conta e tudo o que há nela, e isso será feito em ${when}.`,
    nothingYet: 'Nada foi removido ainda, e o seu padrinho continua funcionando exatamente como antes até lá. ',
    withLink: (link) => `Você pode cancelar isso aqui, a qualquer momento antes dessa data:\n\n${link}\n\n`
      + 'Ou simplesmente responda a esta mensagem e faremos isso por você. De qualquer forma, você não terá perdido nada.',
    noLink: 'É só responder a esta mensagem a qualquer momento antes dessa data que nós cancelamos, e você não terá perdido nada.',
    button: 'Manter minha conta',
    templateBeta: 'Olá {{1}}, um aviso rápido sobre a sua conta, não é uma mensagem do seu padrinho. '
      + 'Recebemos o seu pedido para excluir a sua conta e tudo o que há nela, e isso será feito em {{2}}. '
      + 'Nada foi removido ainda e o seu padrinho continua funcionando exatamente como antes até lá. '
      + 'Você pode cancelar isso com o botão abaixo, ou respondendo aqui, a qualquer momento antes dessa data.',
    templatePaid: 'Olá {{1}}, um aviso rápido sobre a sua conta, não é uma mensagem do seu padrinho. '
      + 'Sua assinatura foi cancelada na hora, então nada mais será cobrado no seu cartão. '
      + 'Também recebemos o seu pedido para excluir a sua conta e tudo o que há nela, e isso será feito em {{2}}. '
      + 'Nada foi removido ainda e o seu padrinho continua funcionando exatamente como antes até lá. '
      + 'Você pode cancelar isso com o botão abaixo, ou respondendo aqui, a qualquer momento antes dessa data.',
  },
  ru: {
    deleteOnly: (when) => `Мы получили ваш запрос на удаление аккаунта и всех его данных. Это будет сделано ${when}.`,
    cardAndDelete: (when) => 'Ваша подписка отменена сразу, поэтому с вашей карты больше ничего не спишется. '
      + `Мы также получили ваш запрос на удаление аккаунта и всех его данных, и это будет сделано ${when}.`,
    nothingYet: 'Пока ничего не удалено, и ваш спонсор до этого момента работает как обычно. ',
    withLink: (link) => `Вы можете отменить удаление здесь в любой момент до этой даты:\n\n${link}\n\n`
      + 'Или просто ответьте на это сообщение, и мы сделаем это за вас. В любом случае вы ничего не потеряете.',
    noLink: 'Просто ответьте на это сообщение в любой момент до этой даты, и мы всё отменим. Вы ничего не потеряете.',
    button: 'Сохранить аккаунт',
    templateBeta: 'Здравствуйте, {{1}}. Короткое сообщение о вашем аккаунте, это пишет не ваш спонсор. '
      + 'Мы получили ваш запрос на удаление аккаунта и всех его данных, и это будет сделано {{2}}. '
      + 'Пока ничего не удалено, и ваш спонсор до этого момента работает как обычно. '
      + 'Вы можете отменить удаление кнопкой ниже или ответив здесь в любой момент до этой даты.',
    templatePaid: 'Здравствуйте, {{1}}. Короткое сообщение о вашем аккаунте, это пишет не ваш спонсор. '
      + 'Ваша подписка отменена сразу, поэтому с вашей карты больше ничего не спишется. '
      + 'Мы также получили ваш запрос на удаление аккаунта и всех его данных, и это будет сделано {{2}}. '
      + 'Пока ничего не удалено, и ваш спонсор до этого момента работает как обычно. '
      + 'Вы можете отменить удаление кнопкой ниже или ответив здесь в любой момент до этой даты.',
  },
};

function leavingBody(lang, paid, { first, when, link }) {
  const c = LEAVING[lang];
  return `${OPENER[lang](first)}\n\n`
    + `${paid ? c.cardAndDelete(when) : c.deleteOnly(when)}\n\n`
    + c.nothingYet
    + (link ? c.withLink(link) : c.noLink);
}

/* ── Trial ending ───────────────────────────────────────────────────────────
   The price stays in dollars in every language, written the way each one
   writes a dollar amount, because that is what the card is charged in. */
const TRIAL = {
  es: {
    body: (when, link) => `Tus 30 días gratis terminan el ${when}, y entonces empieza el plan de $5 al mes. Si prefieres que no empiece, puedes detenerlo aquí:\n\n${link}\n\nEn cualquier caso, hoy no cambia nada en cómo hablas con tu padrino.`,
    button: 'Gestionar mi plan',
    /* trial_ending_v2, submitted as UTILITY Sep 17: Meta filed "template" above as
       MARKETING and will not change it, so this is the billing-notice rewrite. */
    templateV2: "Hola {{1}}, tu prueba gratuita de AI Sponsor termina el {{2}}. Ese día se cobrará en tu tarjeta la suscripción mensual de 5 USD. Puedes cambiar o cancelar tu plan antes de esa fecha con el botón de abajo. Este es un aviso de tu cuenta, no un mensaje de tu padrino.",
    template: 'Hola {{1}}, una nota rápida sobre tu cuenta de AI Sponsor, no es un mensaje de tu padrino. Tus 30 días gratis terminan el {{2}} y entonces empieza el plan mensual de $5. Puedes cambiarlo o cancelarlo en cualquier momento.',
  },
  fr: {
    body: (when, link) => `Vos 30 jours gratuits se terminent le ${when}, et l'abonnement à 5 $ par mois commence alors. Si vous préférez qu'il ne commence pas, vous pouvez l'arrêter ici :\n\n${link}\n\nDans tous les cas, rien ne change aujourd'hui dans vos échanges avec votre parrain.`,
    button: 'Gérer mon abonnement',
    /* trial_ending_v2, submitted as UTILITY Sep 17: Meta filed "template" above as
       MARKETING and will not change it, so this is the billing-notice rewrite. */
    templateV2: "Bonjour {{1}}, votre essai gratuit AI Sponsor se termine le {{2}}. Ce jour-là, l'abonnement mensuel de 5 USD sera prélevé sur votre carte. Vous pouvez modifier ou annuler votre formule avant cette date avec le bouton ci-dessous. Ceci est un avis concernant votre compte, pas un message de votre parrain.",
    template: "Bonjour {{1}}, petit message au sujet de votre compte AI Sponsor, ce n'est pas votre parrain qui vous écrit. Vos 30 jours gratuits se terminent le {{2}} et l'abonnement mensuel à 5 $ commence alors. Vous pouvez le modifier ou l'annuler à tout moment.",
  },
  de: {
    body: (when, link) => `Deine kostenlosen 30 Tage enden am ${when}, dann startet der Plan für 5 $ im Monat. Wenn du das nicht möchtest, kannst du ihn hier stoppen:\n\n${link}\n\nSo oder so ändert sich heute nichts daran, wie du mit deinem Sponsor sprichst.`,
    button: 'Plan verwalten',
    /* trial_ending_v2, submitted as UTILITY Sep 17: Meta filed "template" above as
       MARKETING and will not change it, so this is the billing-notice rewrite. */
    templateV2: "Hallo {{1}}, dein kostenloser Testzeitraum bei AI Sponsor endet am {{2}}. An diesem Tag wird das Monatsabo über 5 USD von deiner Karte abgebucht. Du kannst deinen Tarif vor diesem Datum über den Button unten ändern oder kündigen. Dies ist eine Kontoinformation, keine Nachricht von deinem Sponsor.",
    template: 'Hallo {{1}}, kurze Info zu deinem AI Sponsor Konto, keine Nachricht von deinem Sponsor. Deine kostenlosen 30 Tage enden am {{2}}, dann startet der Monatsplan für 5 $. Du kannst ihn jederzeit ändern oder kündigen.',
  },
  it: {
    body: (when, link) => `I tuoi 30 giorni gratuiti terminano il ${when}, e da quel momento parte il piano da 5 $ al mese. Se preferisci di no, puoi fermarlo qui:\n\n${link}\n\nIn ogni caso, oggi non cambia nulla nel modo in cui parli con il tuo sponsor.`,
    button: 'Gestisci il piano',
    template: 'Ciao {{1}}, una breve nota sul tuo account AI Sponsor, non è un messaggio del tuo sponsor. I tuoi 30 giorni gratuiti terminano il {{2}} e da quel momento parte il piano mensile da 5 $. Puoi modificarlo o annullarlo in qualsiasi momento.',
  },
  pt: {
    body: (when, link) => `Seus 30 dias grátis terminam em ${when}, e o plano de US$ 5 por mês começa nessa data. Se preferir que não comece, você pode cancelar aqui:\n\n${link}\n\nDe qualquer forma, nada muda hoje na forma como você conversa com o seu padrinho.`,
    button: 'Gerenciar meu plano',
    template: 'Olá {{1}}, um aviso rápido sobre a sua conta do AI Sponsor, não é uma mensagem do seu padrinho. Seus 30 dias grátis terminam em {{2}} e o plano mensal de US$ 5 começa nessa data. Você pode alterar ou cancelar a qualquer momento.',
  },
  ru: {
    body: (when, link) => `Ваши бесплатные 30 дней заканчиваются ${when}, и тогда начнётся тариф за $5 в месяц. Если вы не хотите, чтобы он начался, его можно отменить здесь:\n\n${link}\n\nВ любом случае сегодня ничего не меняется в том, как вы общаетесь со своим спонсором.`,
    button: 'Управлять тарифом',
    template: 'Здравствуйте, {{1}}. Короткое сообщение о вашем аккаунте AI Sponsor, это пишет не ваш спонсор. Ваши бесплатные 30 дней заканчиваются {{2}}, и тогда начнётся ежемесячный тариф за $5. Вы можете изменить или отменить его в любой момент.',
  },
};

function trialBody(lang, { first, when, link }) {
  return `${OPENER[lang](first)}\n\n${TRIAL[lang].body(when, link)}`;
}

/* ── Weekly note (the sponsor talking) ─────────────────────────────────────
   greet(first) is what goes in front when there is a name. Each tone's
   text(link) is written to follow it, lower case where the language allows,
   and is capitalised when there is no name. */
const WEEKLY = {
  es: {
    greet: (first) => `${first}, `,
    hard: (link) => `he estado pensando en tu semana. Te escribí algunas cosas, solo si las quieres:\n\n${link}\n\nNo hace falta que respondas. Aquí estoy de todos modos.`,
    quiet: (link) => `semana tranquila entre nosotros, y está bien. Te dejé una nota corta aquí por si la quieres:\n\n${link}`,
    good: (link) => `repasé tu semana y te la dejé por escrito. Está aquí cuando quieras:\n\n${link}`,
    button: 'Ver tu semana',
    templates: {
      hard: 'Hola {{1}}, he estado pensando en tu semana. Te escribí algunas cosas, solo si las quieres. No hace falta que respondas. Aquí estoy de todos modos.',
      quiet: 'Hola {{1}}, semana tranquila entre nosotros, y está bien. Te dejé una nota corta por si la quieres.',
      good: 'Hola {{1}}, repasé tu semana y te la dejé por escrito. Está aquí cuando quieras.',
    },
    privacy: '\n\nTambién actualizamos nuestra política de privacidad, que explica qué guardo y cómo borrarlo. Está enlazada arriba en esa página.',
  },
  fr: {
    greet: (first) => `${first}, `,
    hard: (link) => `j'ai pensé à ta semaine. Je t'ai écrit quelques mots, seulement si tu en as envie :\n\n${link}\n\nPas besoin de répondre. Je suis là, quoi qu'il arrive.`,
    quiet: (link) => `semaine calme entre nous, et c'est très bien. Je t'ai laissé un petit mot ici si tu le veux :\n\n${link}`,
    good: (link) => `j'ai repensé à ta semaine et je l'ai mise par écrit pour toi. C'est ici, quand tu veux :\n\n${link}`,
    button: 'Voir ta semaine',
    templates: {
      hard: "Salut {{1}}, j'ai pensé à ta semaine. Je t'ai écrit quelques mots, seulement si tu en as envie. Pas besoin de répondre. Je suis là, quoi qu'il arrive.",
      quiet: "Salut {{1}}, semaine calme entre nous, et c'est très bien. Je t'ai laissé un petit mot si tu le veux.",
      good: "Salut {{1}}, j'ai repensé à ta semaine et je l'ai mise par écrit pour toi. C'est là, quand tu veux.",
    },
    privacy: '\n\nNous avons aussi mis à jour notre politique de confidentialité, qui explique ce que je garde et comment le supprimer. Le lien est en haut de cette page.',
  },
  de: {
    greet: (first) => `${first}, `,
    hard: (link) => `ich habe an deine Woche gedacht. Ich habe dir ein paar Gedanken aufgeschrieben, nur wenn du sie möchtest:\n\n${link}\n\nDu musst nicht antworten. Ich bin so oder so da.`,
    quiet: (link) => `eine ruhige Woche zwischen uns, und das ist in Ordnung. Ich habe dir hier eine kurze Notiz hinterlassen, falls du sie möchtest:\n\n${link}`,
    good: (link) => `ich habe auf deine Woche zurückgeschaut und sie für dich aufgeschrieben. Sie ist hier, wann immer du magst:\n\n${link}`,
    button: 'Deine Woche ansehen',
    templates: {
      hard: 'Hallo {{1}}, ich habe an deine Woche gedacht. Ich habe dir ein paar Gedanken aufgeschrieben, nur wenn du sie möchtest. Du musst nicht antworten. Ich bin so oder so da.',
      quiet: 'Hallo {{1}}, eine ruhige Woche zwischen uns, und das ist in Ordnung. Ich habe dir eine kurze Notiz hinterlassen, falls du sie möchtest.',
      good: 'Hallo {{1}}, ich habe auf deine Woche zurückgeschaut und sie für dich aufgeschrieben. Sie ist da, wann immer du magst.',
    },
    privacy: '\n\nWir haben außerdem unsere Datenschutzerklärung aktualisiert. Sie erklärt, was ich speichere und wie du es löschen kannst. Sie ist oben auf dieser Seite verlinkt.',
  },
  it: {
    greet: (first) => `${first}, `,
    hard: (link) => `ho pensato alla tua settimana. Ti ho scritto qualche riga, solo se ti va:\n\n${link}\n\nNon serve rispondere. Io ci sono comunque.`,
    quiet: (link) => `settimana tranquilla tra noi, e va bene così. Ti ho lasciato una breve nota qui, se ti va:\n\n${link}`,
    good: (link) => `ho ripensato alla tua settimana e l'ho messa per iscritto per te. È qui quando vuoi:\n\n${link}`,
    button: 'Vedi la tua settimana',
    templates: {
      hard: 'Ciao {{1}}, ho pensato alla tua settimana. Ti ho scritto qualche riga, solo se ti va. Non serve rispondere. Io ci sono comunque.',
      quiet: 'Ciao {{1}}, settimana tranquilla tra noi, e va bene così. Ti ho lasciato una breve nota, se ti va.',
      good: "Ciao {{1}}, ho ripensato alla tua settimana e l'ho messa per iscritto per te. È qui quando vuoi.",
    },
    privacy: "\n\nAbbiamo anche aggiornato la nostra informativa sulla privacy, che spiega cosa conservo e come eliminarlo. Il link è in cima a quella pagina.",
  },
  pt: {
    greet: (first) => `${first}, `,
    hard: (link) => `fiquei pensando na sua semana. Escrevi algumas coisas para você, só se quiser:\n\n${link}\n\nNão precisa responder. Estou aqui de qualquer jeito.`,
    quiet: (link) => `semana tranquila entre a gente, e está tudo bem. Deixei um recadinho aqui, se você quiser:\n\n${link}`,
    good: (link) => `dei uma olhada na sua semana e escrevi tudo para você. Está aqui quando quiser:\n\n${link}`,
    button: 'Ver sua semana',
    templates: {
      hard: 'Oi {{1}}, fiquei pensando na sua semana. Escrevi algumas coisas para você, só se quiser. Não precisa responder. Estou aqui de qualquer jeito.',
      quiet: 'Oi {{1}}, semana tranquila entre a gente, e está tudo bem. Deixei um recadinho, se você quiser.',
      good: 'Oi {{1}}, dei uma olhada na sua semana e escrevi tudo para você. Está aqui quando quiser.',
    },
    privacy: '\n\nTambém atualizamos nossa política de privacidade, que explica o que eu guardo e como excluir. O link está no topo daquela página.',
  },
  ru: {
    greet: (first) => `${first}, `,
    hard: (link) => `твоя неделя не выходит у меня из головы. Здесь пара мыслей для тебя, только если захочешь:\n\n${link}\n\nОтвечать не нужно. Я всё равно рядом.`,
    quiet: (link) => `тихая неделя у нас, и это нормально. Здесь короткая заметка для тебя, если захочешь:\n\n${link}`,
    good: (link) => `вот твоя неделя, собранная в несколько строк. Загляни, когда захочешь:\n\n${link}`,
    button: 'Посмотреть неделю',
    templates: {
      hard: 'Привет, {{1}}. Твоя неделя не выходит у меня из головы. Здесь пара мыслей для тебя, только если захочешь. Отвечать не нужно. Я всё равно рядом.',
      quiet: 'Привет, {{1}}. Тихая неделя у нас, и это нормально. Здесь короткая заметка для тебя, если захочешь.',
      good: 'Привет, {{1}}. Вот твоя неделя, собранная в несколько строк. Загляни, когда захочешь.',
    },
    privacy: '\n\nМы также обновили политику конфиденциальности: там объясняется, что я храню и как это удалить. Ссылка вверху той страницы.',
  },
};

function weeklyBody(lang, tone, { first, link }) {
  const c = WEEKLY[lang];
  const text = (c[tone] || c.good)(link);
  return first ? c.greet(first) + text : cap(text);
}

/* ── "Your weekly note is ready" (the service, not the sponsor) ─────────────
   weekly_note_ready, submitted as UTILITY on Sep 17 in all seven languages.
   Sent when the tone template in their language is not an approved UTILITY
   template, so that the notice reaches everyone, US numbers included. Plain on
   purpose: no tone, no persuasion, just the update and the button. English is
   in weekly.js. Must match what Meta holds, word for word. */
const WEEKLY_READY = {
  es: { template: 'Hola {{1}}, tu nota semanal de AI Sponsor está lista. Puedes leerla en la página de tu cuenta con el botón de abajo.', button: 'Ver tu semana' },
  fr: { template: 'Bonjour {{1}}, votre note de la semaine AI Sponsor est prête. Vous pouvez la lire sur la page de votre compte avec le bouton ci-dessous.', button: 'Voir votre semaine' },
  de: { template: 'Hallo {{1}}, deine Wochennotiz von AI Sponsor ist fertig. Du kannst sie über den Button unten auf deiner Kontoseite lesen.', button: 'Deine Woche ansehen' },
  it: { template: 'Ciao {{1}}, la tua nota settimanale di AI Sponsor è pronta. Puoi leggerla nella pagina del tuo account con il pulsante qui sotto.', button: 'Vedi la tua settimana' },
  pt: { template: 'Olá {{1}}, sua nota semanal do AI Sponsor está pronta. Você pode lê-la na página da sua conta pelo botão abaixo.', button: 'Ver sua semana' },
  ru: { template: 'Здравствуйте, {{1}}. Ваша еженедельная заметка от AI Sponsor готова. Её можно прочитать на странице вашего аккаунта по кнопке ниже.', button: 'Посмотреть неделю' },
};

/* ── The quiet-week card ─────────────────────────────────────────────────────
   What weekly.js writes in code when there was too little to summarise. No
   message counts here: plurals differ in every language, and the English
   count is not the point of the card. */
const QUIET_CARD = {
  es: {
    none: 'No hablamos esta semana. Está permitido, y no deshace nada. Aquí estoy cuando me necesites, y no hace falta ponerse al día antes.',
    some: 'Una semana tranquila entre nosotros. No es un fracaso y no llevo la cuenta. Cuando quieras hablar con calma, aquí estoy.',
    nextWeek: 'Esta semana no hay tarea de mi parte. Solo escríbeme cuando surja algo, aunque sea pequeño.',
  },
  fr: {
    none: "On ne s'est pas parlé cette semaine. C'est permis, et ça n'efface rien. Je suis là quand tu veux, et il n'y a rien à rattraper avant.",
    some: "Une semaine calme entre nous. Ce n'est pas un échec et je ne compte pas les points. Quand tu voudras vraiment parler, je suis là.",
    nextWeek: "Pas de tâche de ma part cette semaine. Écris-moi simplement quand quelque chose arrive, même si c'est petit.",
  },
  de: {
    none: 'Wir haben diese Woche nicht gesprochen. Das ist in Ordnung, und es macht nichts rückgängig. Ich bin da, wenn du mich brauchst, und du musst nichts nachholen.',
    some: 'Eine ruhige Woche zwischen uns. Das ist kein Scheitern, und ich zähle nicht mit. Wann immer du richtig reden willst, bin ich da.',
    nextWeek: 'Diese Woche keine Aufgabe von mir. Schreib mir einfach, wenn etwas ist, auch wenn es klein ist.',
  },
  it: {
    none: "Questa settimana non ci siamo sentiti. Va bene così, e non cancella nulla. Sono qui quando vuoi, e non c'è niente da recuperare prima.",
    some: 'Una settimana tranquilla tra noi. Non è un fallimento e non tengo il conto. Quando vuoi parlare davvero, sono qui.',
    nextWeek: 'Nessun compito da parte mia questa settimana. Scrivimi quando succede qualcosa, anche se è piccola.',
  },
  pt: {
    none: 'A gente não conversou esta semana. Tudo bem, e isso não desfaz nada. Estou aqui quando você quiser, e não tem nada para colocar em dia antes.',
    some: 'Uma semana tranquila entre a gente. Não é um fracasso e eu não estou contando pontos. Quando quiser conversar de verdade, estou aqui.',
    nextWeek: 'Nenhuma tarefa minha esta semana. É só me mandar mensagem quando surgir alguma coisa, mesmo que pequena.',
  },
  ru: {
    none: 'На этой неделе мы не говорили. Так бывает, и это ничего не перечёркивает. Я рядом, когда захочешь, и ничего не нужно навёрстывать.',
    some: 'Тихая неделя у нас. Это не провал, и я ничего не подсчитываю. Когда захочешь поговорить по-настоящему, я здесь.',
    nextWeek: 'На этой неделе никаких заданий от меня. Просто напиши, когда что-то случится, даже если это мелочь.',
  },
};

/* ── Quiet check-in (the sponsor talking) ──────────────────────────────────── */
const CHECKIN = {
  es: { hi: (f) => `Hola ${f}, `, text: 'han pasado unos días. Sin ningún motivo, solo quería saber cómo estás.',
    template: 'Hola {{1}}, han pasado unos días. Sin ningún motivo, solo quería saber cómo estás.' },
  fr: { hi: (f) => `Salut ${f}, `, text: 'ça fait quelques jours. Rien de particulier, je voulais juste prendre de tes nouvelles.',
    template: 'Salut {{1}}, ça fait quelques jours. Rien de particulier, je voulais juste prendre de tes nouvelles.' },
  de: { hi: (f) => `Hallo ${f}, `, text: 'es ist ein paar Tage her. Kein bestimmter Grund, ich wollte nur hören, wie es dir geht.',
    template: 'Hallo {{1}}, es ist ein paar Tage her. Kein bestimmter Grund, ich wollte nur hören, wie es dir geht.' },
  it: { hi: (f) => `Ciao ${f}, `, text: "sono passati un po' di giorni. Nessun motivo particolare, volevo solo sapere come stai.",
    template: "Ciao {{1}}, sono passati un po' di giorni. Nessun motivo particolare, volevo solo sapere come stai." },
  pt: { hi: (f) => `Oi ${f}, `, text: 'faz alguns dias. Nada de especial, só queria saber como você está.',
    template: 'Oi {{1}}, faz alguns dias. Nada de especial, só queria saber como você está.' },
  ru: { hi: (f) => `Привет, ${f}. `, text: 'Прошло несколько дней. Ничего особенного, просто хотелось узнать, как ты.',
    template: 'Привет, {{1}}. Прошло несколько дней. Ничего особенного, просто хотелось узнать, как ты.' },
};

/* ── The check-in they asked for (Mariam, Sep 17) ───────────────────────────
   checkin_requested, submitted as UTILITY in all seven languages: check-ins
   are on request, and the message says so. The sponsor talking, informal,
   Russian without gendered past tense. English is in checkin.js. Must match
   what Meta holds, word for word. */
const CHECKIN_REQUESTED = {
  es: { template: "Hola {{1}}, me pediste que te escribiera si pasaban unos días sin saber de ti, así que aquí estoy. Respóndeme cuando quieras hablar. Puedes desactivar estos mensajes en tus ajustes.", button: "Gestionar mensajes" },
  fr: { template: "Salut {{1}}, tu m'as demandé de prendre de tes nouvelles si je n'avais pas de nouvelles de toi pendant quelques jours, alors me voilà. Réponds-moi quand tu veux parler. Tu peux désactiver ces messages dans tes réglages.", button: "Gérer ces messages" },
  de: { template: "Hallo {{1}}, du hast mich gebeten, mich zu melden, wenn ich ein paar Tage nichts von dir höre, also bin ich hier. Antworte, wann immer du reden möchtest. Du kannst diese Nachrichten in deinen Einstellungen ausschalten.", button: "Nachrichten verwalten" },
  it: { template: "Ciao {{1}}, mi avevi chiesto di scriverti se per qualche giorno non avessi avuto tue notizie, quindi eccomi. Rispondimi quando vuoi parlare. Puoi disattivare questi messaggi nelle tue impostazioni.", button: "Gestisci i messaggi" },
  pt: { template: "Oi {{1}}, você me pediu para mandar mensagem se eu ficasse alguns dias sem notícias suas, então aqui estou. Me responda quando quiser conversar. Você pode desativar essas mensagens nas suas configurações.", button: "Gerenciar mensagens" },
  ru: { template: "Привет, {{1}}. По твоей просьбе пишу, если несколько дней от тебя нет вестей. Я здесь, отвечай, когда захочешь поговорить. Эти сообщения можно отключить в настройках.", button: "Настроить сообщения" },
};

function checkinBody(lang, first) {
  const c = CHECKIN[lang];
  return first ? c.hi(first) + c.text : cap(c.text);
}

module.exports = {
  SERVICE_NAME_FALLBACK, SPONSOR_NAME_FALLBACK,
  OPENER, LEAVING, TRIAL, WEEKLY, WEEKLY_READY, QUIET_CARD, CHECKIN, CHECKIN_REQUESTED,
  leavingBody, trialBody, weeklyBody, checkinBody,
};
