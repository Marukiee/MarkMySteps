/**
 * Every word on the site, in Dutch and English. Written the way the app
 * talks: short, warm, no dashes, date ranges with "t/m".
 */

export type Lang = 'nl' | 'en';

export const CONTACT = 'mark@markmaaktmedia.nl';
export const GITHUB = 'https://github.com/Marukiee/MarkMySteps';
export const APK = 'https://github.com/Marukiee/MarkMySteps/releases/latest/download/markmysteps.apk';
export const INSTALL = 'https://github.com/Marukiee/MarkMySteps/blob/main/docs/DEPLOY.md';

/** The path of the same page in the other language. */
export const PATHS = {
  home: { nl: '/', en: '/en/' },
  privacy: { nl: '/privacy/', en: '/en/privacy/' },
  help: { nl: '/hulp/', en: '/en/help/' },
} as const;

export type PageId = keyof typeof PATHS;

const nl = {
  meta: {
    title: 'MarkMySteps: je reis, vanzelf op de kaart',
    description:
      'Houd je reis bij op een kaart, met je route, je foto’s en je reisgenoten. Voor iPhone en Android, op je eigen server, zonder Google.',
  },
  nav: {
    how: 'Zo werkt het',
    features: 'Wat hij kan',
    privacy: 'Privacy',
    faq: 'Vragen',
    download: 'Download',
    skip: 'Naar de inhoud',
    menu: 'Menu',
    otherLang: 'English',
    otherLangShort: 'EN',
  },
  hero: {
    eyebrow: 'Reisdagboek voor iPhone en Android',
    title: 'Je reis, vanzelf op de kaart.',
    lead:
      'MarkMySteps houdt onderweg je route bij, zet je foto’s op de plek waar je ze nam en maakt van elke reis een verhaal dat je samen met je reisgenoten terugkijkt.',
    iphone: 'Voor iPhone',
    android: 'Voor Android',
    note: 'Gratis en open source. Zonder Google, zonder reclame.',
    globe: 'Een wereldbol met de vluchten van een paar reizen',
    shot: 'De kaart van een reis door Portugal in MarkMySteps',
  },
  how: {
    eyebrow: 'Zo werkt het',
    title: 'Plannen, reizen, terugkijken.',
    steps: [
      {
        icon: 'route',
        title: 'Plan je route',
        body: 'Zet je stops op volgorde, kies hoeveel nachten je blijft en hoe je verder reist. De datums schuiven vanzelf mee.',
      },
      {
        icon: 'locate',
        title: 'Reis gewoon',
        body: 'Je telefoon houdt je route bij, ook met het scherm uit. Zuinig: hij meet alleen als je echt beweegt.',
      },
      {
        icon: 'sparkle',
        title: 'Beleef het opnieuw',
        body: 'Je foto’s staan op de kaart waar je ze nam. Maak er een poster of fotoboek van, of deel een link.',
      },
    ],
  },
  features: {
    eyebrow: 'Wat hij kan',
    title: 'Alles van je reis op één plek.',
    items: [
      {
        id: 'map',
        icon: 'map',
        title: 'Je hele reis op één kaart',
        body: 'Je route, je stops en je foto’s samen op de kaart, dag voor dag. Zet de route van een reisgenoot aan of uit, en neem de kaart offline mee.',
        points: ['Route per reisgenoot', 'Foto’s op de plek waar je ze nam', 'Kaarten ook zonder internet'],
        shot: 'De kaart van een reis met route, stops en foto’s',
      },
      {
        id: 'planner',
        icon: 'route',
        title: 'Een routeplanner die meedenkt',
        body: 'Sleep je stops op volgorde en zeg hoeveel nachten je ergens blijft. Kies per stuk hoe je reist: auto, trein, bus, boot of vliegtuig.',
        points: ['Datums schuiven vanzelf mee', 'Routes over de weg en het spoor', 'Vluchten van ruim 4000 vliegvelden'],
        shot: 'De routeplanner met stops, nachten en vervoer',
      },
      {
        id: 'photos',
        icon: 'camera',
        title: 'Je foto’s blijven van jou',
        body: 'MarkMySteps leest je foto’s uit je eigen Immich of van je telefoon. Er wordt niets gekopieerd of geüpload: ze blijven waar ze zijn.',
        points: ['Uit Immich of je eigen galerij', 'Per dag in de tijdlijn', 'Reacties en likes van je reisgenoten'],
        shot: 'De tijdlijn van een reisdag met foto’s',
      },
      {
        id: 'together',
        icon: 'people',
        title: 'Samen op reis',
        body: 'Voeg je reisgenoten toe, dan zie je elkaars route en foto’s. Wie thuisblijft, kijkt mee als gast.',
        points: ['Reisgenoten en gasten', 'Deellink, desnoods met wachtwoord', 'Meldingen als er iets nieuws is'],
        shot: 'De reisgenoten en gasten van een reis',
      },
    ],
    more: {
      title: 'En verder',
      items: [
        { icon: 'frame', title: 'Posters', body: 'Een poster van je reis of van één dag, met je route, je foto’s, de cijfers en het weer van toen.' },
        { icon: 'globe', title: 'Je statistieken', body: 'Kilometers, landen en dagen onderweg, en al je reizen samen op de wereldbol.' },
        { icon: 'book', title: 'Fotoboek', body: 'Je hele reis op volgorde, met je verhalen erbij, klaar om af te drukken.' },
        { icon: 'download', title: 'Offline kaarten', body: 'Bewaar de kaart van je reis op je telefoon, dan werkt hij ook zonder internet.' },
        { icon: 'plane', title: 'Vluchten', body: 'Vlieg van en naar ruim 4000 vliegvelden, met de vlucht als boog op de kaart.' },
        { icon: 'bell', title: 'Meldingen', body: 'Hoor het als een reisgenoot iets nieuws deelt of op je foto reageert.' },
      ],
    },
  },
  own: {
    eyebrow: 'Van jou',
    title: 'Je reis is van jou, niet van ons.',
    lead: 'Geen account bij een bedrijf, geen reclame, niemand die meekijkt. MarkMySteps draait op een server die van jou is, of van iemand die je vertrouwt.',
    items: [
      { icon: 'shield', title: 'Je eigen server', body: 'Je route, je reizen en je verhalen staan op jouw server. Eén commando en hij draait.' },
      { icon: 'cloud-off', title: 'Zonder Google', body: 'Geen Google Maps, geen Google-diensten. Werkt ook op telefoons zonder Google, zoals GrapheneOS.' },
      { icon: 'eye-off', title: 'Niemand kijkt mee', body: 'Geen reclame, geen analytics, geen tracking. Ook niet op deze website.' },
      { icon: 'book', title: 'Open source', body: 'De code staat open op GitHub. Kijk gerust mee, of help mee.' },
    ],
  },
  devices: {
    eyebrow: 'Op elk toestel',
    title: 'Voelt thuis, waar je hem ook opent.',
    items: [
      { icon: 'phone', title: 'iPhone', body: 'Met de onderdelen van iOS zelf: glazen knoppen, de menu’s, de datumkiezer en schakelaars.' },
      { icon: 'phone', title: 'Android', body: 'Een losse app, ook zonder Google Play. Nieuwe versies haal je in de app zelf binnen.' },
      { icon: 'monitor', title: 'Computer', body: 'Gewoon in de browser, met dezelfde kaart en dezelfde reizen.' },
    ],
  },
  download: {
    eyebrow: 'Download',
    title: 'Klaar om te gaan?',
    iphone: {
      title: 'iPhone',
      body: 'Binnenkort in de App Store. Nu al meedoen met de test via TestFlight? Stuur een mailtje.',
      cta: 'Vraag een uitnodiging',
    },
    android: {
      title: 'Android',
      body: 'Download de app rechtstreeks, ook voor telefoons zonder Google. Updates komen daarna vanzelf.',
      cta: 'Download de app',
    },
    server: {
      title: 'Je eigen server',
      body: 'MarkMySteps draait op je eigen server, zoals een kleine thuisserver. Met één commando staat hij er.',
      cta: 'Zo zet je hem op',
    },
  },
  faq: {
    eyebrow: 'Vragen',
    title: 'Wat mensen vaak vragen.',
    items: [
      {
        q: 'Wat kost het?',
        a: 'Niets. MarkMySteps is gratis en open source. Wil je je eigen server, dan betaal je alleen die.',
      },
      {
        q: 'Heb ik een eigen server nodig?',
        a: 'Je hebt een MarkMySteps-server nodig: je eigen, of die van iemand die je uitnodigt. Zelf een opzetten kan met één commando, bijvoorbeeld op een kleine thuisserver.',
      },
      {
        q: 'Hoeveel batterij kost het?',
        a: 'Weinig. De app meet alleen als je echt beweegt en rust als jij stilstaat. Tracking zet je per reis aan en weer uit.',
      },
      {
        q: 'Wat gebeurt er met mijn foto’s?',
        a: 'Die blijven waar ze zijn: in je eigen Immich of op je telefoon. MarkMySteps laat ze zien, maar kopieert of uploadt ze niet.',
      },
      {
        q: 'Werkt het zonder Google?',
        a: 'Ja. Er zit geen Google in de app: geen Google Maps en geen Google-diensten voor locatie of meldingen. Hij werkt ook op GrapheneOS en LineageOS.',
      },
      {
        q: 'Wie kan mijn reis zien?',
        a: 'Alleen wie jij toevoegt: reisgenoten die meereizen, of gasten die alleen meekijken. Een deellink maak je zelf, desnoods met een wachtwoord.',
      },
    ],
  },
  footer: {
    made: 'MarkMySteps is gemaakt door Mark Maakt Media.',
    privacy: 'Privacy',
    help: 'Hulp',
    github: 'GitHub',
  },
  help: {
    title: 'Hulp',
    lead: 'Loop je ergens tegenaan, of wil je iets weten? Hier vind je de weg.',
    sections: [
      {
        title: 'Een eigen server opzetten',
        body: 'MarkMySteps draait op je eigen server met Docker. De stappen, van één commando tot een eigen domeinnaam, staan op GitHub.',
        link: 'Naar de installatie',
        href: INSTALL,
      },
      {
        title: 'Iets werkt niet',
        body: 'Meld het op GitHub, met wat je deed en wat er gebeurde. Een schermafbeelding helpt.',
        link: 'Meld een probleem',
        href: `${GITHUB}/issues`,
      },
      {
        title: 'Contact',
        body: 'Een vraag over je account, je gegevens of de test op de iPhone? Mail gerust.',
        link: CONTACT,
        href: `mailto:${CONTACT}`,
      },
    ],
  },
  notFound: {
    title: 'Hier liep je route dood.',
    body: 'Deze pagina bestaat niet (meer). Terug naar het begin?',
    home: 'Naar de voorpagina',
  },
};

type Text = typeof nl;

const en: Text = {
  meta: {
    title: 'MarkMySteps: your trip, on the map by itself',
    description:
      'Keep your trip on a map, with your route, your photos and your travel companions. For iPhone and Android, on your own server, without Google.',
  },
  nav: {
    how: 'How it works',
    features: 'What it does',
    privacy: 'Privacy',
    faq: 'Questions',
    download: 'Download',
    skip: 'Skip to content',
    menu: 'Menu',
    otherLang: 'Nederlands',
    otherLangShort: 'NL',
  },
  hero: {
    eyebrow: 'Travel journal for iPhone and Android',
    title: 'Your trip, on the map by itself.',
    lead:
      'MarkMySteps keeps your route while you travel, puts your photos where you took them and turns every trip into a story you look back on with your travel companions.',
    iphone: 'For iPhone',
    android: 'For Android',
    note: 'Free and open source. No Google, no ads.',
    globe: 'A globe with the flights of a few trips',
    shot: 'The map of a trip through Portugal in MarkMySteps',
  },
  how: {
    eyebrow: 'How it works',
    title: 'Plan, travel, look back.',
    steps: [
      {
        icon: 'route',
        title: 'Plan your route',
        body: 'Put your stops in order, choose how many nights you stay and how you travel on. The dates move along by themselves.',
      },
      {
        icon: 'locate',
        title: 'Just travel',
        body: 'Your phone keeps your route, also with the screen off. Easy on the battery: it only measures when you really move.',
      },
      {
        icon: 'sparkle',
        title: 'Live it again',
        body: 'Your photos sit on the map where you took them. Make a poster or a photo book, or share a link.',
      },
    ],
  },
  features: {
    eyebrow: 'What it does',
    title: 'Everything of your trip in one place.',
    items: [
      {
        id: 'map',
        icon: 'map',
        title: 'Your whole trip on one map',
        body: 'Your route, your stops and your photos together on the map, day by day. Turn a companion’s route on or off, and take the map offline.',
        points: ['A route per companion', 'Photos where you took them', 'Maps without internet too'],
        shot: 'The map of a trip with route, stops and photos',
      },
      {
        id: 'planner',
        icon: 'route',
        title: 'A route planner that thinks along',
        body: 'Drag your stops into order and say how many nights you stay. Choose how you travel each stretch: car, train, bus, boat or plane.',
        points: ['Dates move along by themselves', 'Routes over road and rail', 'Flights from over 4000 airports'],
        shot: 'The route planner with stops, nights and transport',
      },
      {
        id: 'photos',
        icon: 'camera',
        title: 'Your photos stay yours',
        body: 'MarkMySteps reads your photos from your own Immich or from your phone. Nothing is copied or uploaded: they stay where they are.',
        points: ['From Immich or your own gallery', 'Per day in the timeline', 'Comments and likes from your companions'],
        shot: 'The timeline of a travel day with photos',
      },
      {
        id: 'together',
        icon: 'people',
        title: 'Travel together',
        body: 'Add your travel companions and you see each other’s route and photos. Whoever stays home follows along as a guest.',
        points: ['Companions and guests', 'A share link, with a password if you like', 'Notifications when there is news'],
        shot: 'The companions and guests of a trip',
      },
    ],
    more: {
      title: 'And more',
      items: [
        { icon: 'frame', title: 'Posters', body: 'A poster of your trip or of one day, with your route, your photos, the numbers and the weather of the day.' },
        { icon: 'globe', title: 'Your stats', body: 'Kilometres, countries and days on the road, and all your trips together on the globe.' },
        { icon: 'book', title: 'Photo book', body: 'Your whole trip in order, with your stories, ready to print.' },
        { icon: 'download', title: 'Offline maps', body: 'Keep the map of your trip on your phone, so it works without internet too.' },
        { icon: 'plane', title: 'Flights', body: 'Fly from and to over 4000 airports, with the flight as an arc on the map.' },
        { icon: 'bell', title: 'Notifications', body: 'Hear it when a companion shares something new or reacts to your photo.' },
      ],
    },
  },
  own: {
    eyebrow: 'Yours',
    title: 'Your trip is yours, not ours.',
    lead: 'No account with a company, no ads, nobody watching. MarkMySteps runs on a server that is yours, or belongs to someone you trust.',
    items: [
      { icon: 'shield', title: 'Your own server', body: 'Your route, your trips and your stories live on your server. One command and it runs.' },
      { icon: 'cloud-off', title: 'Without Google', body: 'No Google Maps, no Google services. Works on phones without Google too, like GrapheneOS.' },
      { icon: 'eye-off', title: 'Nobody watching', body: 'No ads, no analytics, no tracking. Not on this website either.' },
      { icon: 'book', title: 'Open source', body: 'The code is open on GitHub. Have a look, or lend a hand.' },
    ],
  },
  devices: {
    eyebrow: 'On every device',
    title: 'Feels at home wherever you open it.',
    items: [
      { icon: 'phone', title: 'iPhone', body: 'With the parts of iOS itself: glass buttons, the menus, the date picker and switches.' },
      { icon: 'phone', title: 'Android', body: 'A standalone app, also without Google Play. New versions arrive inside the app.' },
      { icon: 'monitor', title: 'Computer', body: 'Right in the browser, with the same map and the same trips.' },
    ],
  },
  download: {
    eyebrow: 'Download',
    title: 'Ready to go?',
    iphone: {
      title: 'iPhone',
      body: 'Coming to the App Store soon. Want to join the TestFlight test already? Send an email.',
      cta: 'Ask for an invite',
    },
    android: {
      title: 'Android',
      body: 'Download the app directly, also for phones without Google. Updates arrive by themselves after that.',
      cta: 'Download the app',
    },
    server: {
      title: 'Your own server',
      body: 'MarkMySteps runs on your own server, like a small home server. One command and it is there.',
      cta: 'How to set it up',
    },
  },
  faq: {
    eyebrow: 'Questions',
    title: 'What people often ask.',
    items: [
      { q: 'What does it cost?', a: 'Nothing. MarkMySteps is free and open source. If you want your own server, you only pay for that.' },
      {
        q: 'Do I need my own server?',
        a: 'You need a MarkMySteps server: your own, or that of someone who invites you. Setting one up takes one command, for instance on a small home server.',
      },
      {
        q: 'How much battery does it use?',
        a: 'Little. The app only measures when you really move and rests when you stand still. You turn tracking on and off per trip.',
      },
      {
        q: 'What happens to my photos?',
        a: 'They stay where they are: in your own Immich or on your phone. MarkMySteps shows them, but does not copy or upload them.',
      },
      {
        q: 'Does it work without Google?',
        a: 'Yes. There is no Google in the app: no Google Maps and no Google services for location or notifications. It runs on GrapheneOS and LineageOS too.',
      },
      {
        q: 'Who can see my trip?',
        a: 'Only the people you add: companions who travel with you, or guests who only follow along. You make a share link yourself, with a password if you like.',
      },
    ],
  },
  footer: {
    made: 'MarkMySteps is made by Mark Maakt Media.',
    privacy: 'Privacy',
    help: 'Help',
    github: 'GitHub',
  },
  help: {
    title: 'Help',
    lead: 'Stuck somewhere, or want to know something? This is where you find your way.',
    sections: [
      {
        title: 'Setting up your own server',
        body: 'MarkMySteps runs on your own server with Docker. The steps, from one command to your own domain name, are on GitHub.',
        link: 'To the installation',
        href: INSTALL,
      },
      {
        title: 'Something does not work',
        body: 'Report it on GitHub, with what you did and what happened. A screenshot helps.',
        link: 'Report a problem',
        href: `${GITHUB}/issues`,
      },
      {
        title: 'Contact',
        body: 'A question about your account, your data or the iPhone test? Feel free to email.',
        link: CONTACT,
        href: `mailto:${CONTACT}`,
      },
    ],
  },
  notFound: {
    title: 'Your route ended here.',
    body: 'This page does not exist (any more). Back to the start?',
    home: 'To the home page',
  },
};

export const TEXT: Record<Lang, Text> = { nl, en };
