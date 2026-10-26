import { t } from '../i18n';

/**
 * What a standalone outbound or return leg is called on screen.
 *
 * Its stored name (Heenreis, Heenvlucht, ...) is how the planner, the map and
 * the share page recognise it, so that name stays as it is in the data; this
 * only changes what the reader sees. Any other stop keeps the name it was given.
 */
export function legTitle(name: string): string {
  switch (name) {
    case 'Heenreis':
      return t('planner.outboundTrip');
    case 'Terugreis':
      return t('planner.returnTrip');
    case 'Heenvlucht':
      return t('planner.outboundFlight');
    case 'Terugvlucht':
      return t('planner.returnFlight');
    default:
      return name;
  }
}
