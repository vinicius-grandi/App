import moment from 'moment-timezone';
import {AppState} from 'react-native';
import Onyx from 'react-native-onyx';
import lodashGet from 'lodash/get';
import Str from 'expensify-common/lib/str';
import _ from 'underscore';
import * as API from '../API';
import ONYXKEYS from '../../ONYXKEYS';
import CONST from '../../CONST';
import Log from '../Log';
import Performance from '../Performance';
import Timing from './Timing';
import * as Policy from './Policy';
import Navigation from '../Navigation/Navigation';
import ROUTES from '../../ROUTES';
import * as SessionUtils from '../SessionUtils';

let currentUserAccountID;
let currentUserEmail = '';
Onyx.connect({
    key: ONYXKEYS.SESSION,
    callback: (val) => {
        currentUserAccountID = lodashGet(val, 'accountID', '');
        currentUserEmail = lodashGet(val, 'email', '');
    },
});

let isSidebarLoaded;
Onyx.connect({
    key: ONYXKEYS.IS_SIDEBAR_LOADED,
    callback: val => isSidebarLoaded = val,
    initWithStoredValues: false,
});

let myPersonalDetails;
Onyx.connect({
    key: ONYXKEYS.PERSONAL_DETAILS,
    callback: (val) => {
        if (!val || !currentUserEmail) {
            return;
        }

        myPersonalDetails = val[currentUserEmail];
    },
});

let policyIDList = [];
Onyx.connect({
    key: ONYXKEYS.COLLECTION.POLICY,
    waitForCollectionCallback: true,
    callback: (policies) => {
        policyIDList = _.compact(_.pluck(policies, 'id'));
    },
});

/**
* @param {String} locale
*/
function setLocale(locale) {
    // If user is not signed in, change just locally.
    if (!currentUserAccountID) {
        Onyx.merge(ONYXKEYS.NVP_PREFERRED_LOCALE, locale);
        return;
    }

    // Optimistically change preferred locale
    const optimisticData = [
        {
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.NVP_PREFERRED_LOCALE,
            value: locale,
        },
    ];

    API.write('UpdatePreferredLocale', {
        value: locale,
    }, {optimisticData});
}

function setSidebarLoaded() {
    if (isSidebarLoaded) {
        return;
    }

    Onyx.set(ONYXKEYS.IS_SIDEBAR_LOADED, true);
    Timing.end(CONST.TIMING.SIDEBAR_LOADED);
    Performance.markEnd(CONST.TIMING.SIDEBAR_LOADED);
    Performance.markStart(CONST.TIMING.REPORT_INITIAL_RENDER);
}

let appState;
AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState.match(/inactive|background/) && appState === 'active') {
        Log.info('Flushing logs as app is going inactive', true, {}, true);
    }
    appState = nextAppState;
});

/**
 * Fetches data needed for app initialization
 */
function openApp() {
    API.read('OpenApp', {policyIDList}, {
        optimisticData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: true,
        }],
        successData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: false,
        }],
        failureData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: false,
        }],
    });
}

/**
 * Refreshes data when the app reconnects
 */
function reconnectApp() {
    API.read('ReconnectApp', {policyIDList}, {
        optimisticData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: true,
        }],
        successData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: false,
        }],
        failureData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.IS_LOADING_REPORT_DATA,
            value: false,
        }],
    });
}

/**
 * This action runs when the Navigator is ready and the current route changes
 *
 * currentPath should be the path as reported by the NavigationContainer
 *
 * The transition link contains an exitTo param that contains the route to
 * navigate to after the user is signed in. A user can transition from OldDot
 * with a different account than the one they are currently signed in with, so
 * we only navigate if they are not signing in as a new user. Once they are
 * signed in as that new user, this action will run again and the navigation
 * will occur.

 * When the exitTo route is 'workspace/new', we create a new
 * workspace and navigate to it via Policy.createAndGetPolicyList.
 *
 * We subscribe to the session using withOnyx in the AuthScreens and
 * pass it in as a parameter. withOnyx guarantees that the value has been read
 * from Onyx because it will not render the AuthScreens until that point.
 * @param {Object} session
 * @param {string} currentPath
 */
function setUpPoliciesAndNavigate(session, currentPath) {
    if (!session || !currentPath || !currentPath.includes('exitTo')) {
        return;
    }

    let exitTo;
    try {
        const url = new URL(currentPath, CONST.NEW_EXPENSIFY_URL);
        exitTo = url.searchParams.get('exitTo');
    } catch (error) {
        // URLSearchParams is unsupported on iOS so we catch th error and
        // silence it here since this is primarily a Web flow
        return;
    }

    const isLoggingInAsNewUser = SessionUtils.isLoggingInAsNewUser(currentPath, session.email);
    const shouldCreateFreePolicy = !isLoggingInAsNewUser
                        && Str.startsWith(currentPath, Str.normalizeUrl(ROUTES.TRANSITION_FROM_OLD_DOT))
                        && exitTo === ROUTES.WORKSPACE_NEW;
    if (shouldCreateFreePolicy) {
        Policy.createAndGetPolicyList();
        return;
    }
    if (!isLoggingInAsNewUser && exitTo) {
        // We must call dismissModal() to remove the /transition route from history
        Navigation.dismissModal();
        Navigation.navigate(exitTo);
    }
}

function openProfile() {
    const oldTimezoneData = myPersonalDetails.timezone || {};
    let newTimezoneData = oldTimezoneData;

    if (lodashGet(oldTimezoneData, 'automatic', true)) {
        newTimezoneData = {
            automatic: true,
            selected: moment.tz.guess(true),
        };
    }

    API.write('OpenProfile', {
        timezone: JSON.stringify(newTimezoneData),
    }, {
        optimisticData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.PERSONAL_DETAILS,
            value: {
                [currentUserEmail]: {
                    timezone: newTimezoneData,
                },
            },
        }],
        failureData: [{
            onyxMethod: CONST.ONYX.METHOD.MERGE,
            key: ONYXKEYS.PERSONAL_DETAILS,
            value: {
                [currentUserEmail]: {
                    timezone: oldTimezoneData,
                },
            },
        }],
    });

    Navigation.navigate(ROUTES.SETTINGS_PROFILE);
}

export {
    setLocale,
    setSidebarLoaded,
    setUpPoliciesAndNavigate,
    openProfile,
    openApp,
    reconnectApp,
};
