// The Dutch words, one file per part of the app. See ../../index.ts.
import common from './common.json';
import app from './app.json';
import settings from './settings.json';
import trip from './trip.json';
import planner from './planner.json';
import trips from './trips.json';
import tripSettings from './tripSettings.json';
import share from './share.json';
import summary from './summary.json';
import book from './book.json';
import auth from './auth.json';
import onboarding from './onboarding.json';
import social from './social.json';
import ui from './ui.json';
import local from './local.json';
import apiError from './apiError.json';

export default {
  ...common,
  ...app,
  ...settings,
  ...trip,
  ...planner,
  ...trips,
  ...tripSettings,
  ...share,
  ...summary,
  ...book,
  ...auth,
  ...onboarding,
  ...social,
  ...ui,
  ...local,
  ...apiError,
};
