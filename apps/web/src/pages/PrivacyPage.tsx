import { Link } from 'react-router-dom';
import { LogoMark } from '../components/Logo';
import './privacy.css';

const CONTACT = 'mark@markmaaktmedia.nl';

/**
 * The privacy statement: public, so it can be linked from TestFlight and the
 * App Store, and read before anybody has an account. Plain text on the page's
 * own paper, the way a statement like this should read.
 */
export function PrivacyPage() {
  return (
    <div className="privacy-page">
      <header className="privacy-top">
        <Link to="/" className="privacy-brand">
          <LogoMark size={26} />
          MarkMySteps
        </Link>
      </header>

      <main className="privacy-body fade-in">
        <h1>Privacy</h1>
        <p className="privacy-lede">
          MarkMySteps is een reis-app van Mark Maakt Media. Je route, je reizen en je foto&apos;s
          zijn van jou. Hier staat wat de app bewaart, waarom, en wie het kan zien.
        </p>
        <p className="privacy-date">Bijgewerkt op 25 oktober 2026</p>

        <section>
          <h2>Wat de app bewaart</h2>
          <ul>
            <li>
              <strong>Je account:</strong> je naam, gebruikersnaam, e-mailadres en profielfoto. Je
              wachtwoord wordt alleen versleuteld bewaard.
            </li>
            <li>
              <strong>Je route:</strong> de locatiepunten die de app vastlegt terwijl je een reis
              bijhoudt.
            </li>
            <li>
              <strong>Je reizen:</strong> titels, data, stops, dagverhalen en notities.
            </li>
            <li>
              <strong>Reacties en likes</strong> op foto&apos;s en dagverhalen.
            </li>
            <li>
              <strong>Je Immich-koppeling:</strong> het adres van je Immich-server en de sleutel
              daarvoor, versleuteld. De foto&apos;s zelf blijven in jouw Immich; de app haalt ze daar
              op om ze te tonen.
            </li>
            <li>
              <strong>Meldingen:</strong> een versleuteld kenmerk van je telefoon, zodat die nieuwe
              meldingen kan ophalen.
            </li>
          </ul>
        </section>

        <section>
          <h2>Je locatie</h2>
          <p>
            De app legt je locatie alleen vast als je zelf tracking aanzet voor een reis. Geef je de
            toestemming &ldquo;Altijd&rdquo;, dan neemt de app ook met het scherm uit één meting per
            interval, tot je tracking weer uitzet. Je locatie gaat naar de server van MarkMySteps en
            nergens anders heen.
          </p>
        </section>

        <section>
          <h2>Foto&apos;s op je telefoon</h2>
          <p>
            De app kan foto&apos;s uit de fotobibliotheek van je telefoon tonen bij de reis waar ze bij
            horen. Die foto&apos;s blijven op je telefoon en worden niet geüpload.
          </p>
        </section>

        <section>
          <h2>Wie het ziet</h2>
          <ul>
            <li>De reisgenoten die je aan een reis toevoegt.</li>
            <li>
              Iedereen met een deellink die je zelf maakt, eventueel met een wachtwoord. Wie daar
              reageert, geeft een naam op; likes van bezoekers worden onthouden met een willekeurige
              code in hun eigen browser.
            </li>
            <li>De beheerder van de server, voor onderhoud en als je om hulp vraagt.</li>
          </ul>
        </section>

        <section>
          <h2>Diensten van anderen</h2>
          <p>Een paar dingen haalt de app bij andere diensten op. Die zien dan je IP-adres en:</p>
          <ul>
            <li>
              <strong>Kaarten:</strong> OpenFreeMap, en Esri voor de satellietkaart: welk stuk kaart
              je bekijkt.
            </li>
            <li>
              <strong>Plaatsen zoeken:</strong> Photon van Komoot: wat je intypt.
            </li>
            <li>
              <strong>Weer:</strong> Open-Meteo: de coördinaten van een plaats.
            </li>
            <li>
              <strong>Foto&apos;s van plaatsen:</strong> Wikipedia: de naam van een plaats.
            </li>
            <li>
              <strong>Routes tussen stops:</strong> OSRM voor de auto en signal.eu.org voor de trein:
              de coördinaten van je stops.
            </li>
            <li>
              <strong>Updates van de Android-app:</strong> GitHub.
            </li>
          </ul>
          <p>
            Geen advertenties, geen analytics en geen tracking. Er wordt niets verkocht of gedeeld
            met adverteerders.
          </p>
        </section>

        <section>
          <h2>Waar het staat en hoe lang</h2>
          <p>
            Alles staat op de server van MarkMySteps, beheerd door Mark Maakt Media, en gaat er
            versleuteld (https) naartoe. Je gegevens blijven bewaard zolang je account bestaat.
          </p>
        </section>

        <section>
          <h2>Je rechten</h2>
          <p>
            Je mag je gegevens inzien, laten verbeteren of je account met alles erop laten
            verwijderen. Mail daarvoor naar <a href={`mailto:${CONTACT}`}>{CONTACT}</a>; het is binnen
            een maand geregeld. Ben je het ergens niet mee eens, dan kun je een klacht indienen bij
            de Autoriteit Persoonsgegevens.
          </p>
        </section>

        <section className="privacy-en" lang="en">
          <h2>In short (English)</h2>
          <p>
            MarkMySteps stores your account (name, username, e-mail, profile photo, hashed
            password), the location points recorded while you track a trip, your trips, stories,
            comments and likes, and an encrypted link to your Immich server. Location is only
            recorded when you start tracking, and goes to the MarkMySteps server only. Photos from
            your phone stay on your phone. Data is shared with the trip members you add and with
            anyone you give a share link. Maps, place search, weather, place photos and routing are
            fetched from OpenFreeMap, Esri, Photon, Open-Meteo, Wikipedia, OSRM and signal.eu.org.
            No ads, no analytics, no tracking. For access or deletion, write to{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
