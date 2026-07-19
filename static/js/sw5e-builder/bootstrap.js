/**
 * Mount SW5E character builder modules on window (loaded after app.js).
 */
import { mountSw5eCharacterWizard, unmountSw5eCharacterWizard } from './wizard-shell.js';
import { mountSw5eLevelUpWizard, unmountSw5eLevelUpWizard } from './level-up-wizard.js?v=8';

window.mountSw5eCharacterWizard = mountSw5eCharacterWizard;
window.unmountSw5eCharacterWizard = unmountSw5eCharacterWizard;
window.mountSw5eLevelUpWizard = mountSw5eLevelUpWizard;
window.unmountSw5eLevelUpWizard = unmountSw5eLevelUpWizard;
