import _ from 'underscore';
import Str from 'expensify-common/lib/str';
import lodashGet from 'lodash/get';
import Onyx from 'react-native-onyx';
import moment from 'moment';
import ONYXKEYS from '../ONYXKEYS';
import CONST from '../CONST';
import * as Localize from './Localize';
import * as LocalePhoneNumber from './LocalePhoneNumber';
import * as Expensicons from '../components/Icon/Expensicons';
import md5 from './md5';
import Navigation from './Navigation/Navigation';
import ROUTES from '../ROUTES';
import * as NumberUtils from './NumberUtils';

let sessionEmail;
Onyx.connect({
    key: ONYXKEYS.SESSION,
    callback: val => sessionEmail = val ? val.email : null,
});

let preferredLocale = CONST.DEFAULT_LOCALE;
Onyx.connect({
    key: ONYXKEYS.NVP_PREFERRED_LOCALE,
    callback: (val) => {
        if (!val) {
            return;
        }
        preferredLocale = val;
    },
});

let currentUserEmail;
let currentUserAccountID;
Onyx.connect({
    key: ONYXKEYS.SESSION,
    callback: (val) => {
        // When signed out, val is undefined
        if (!val) {
            return;
        }

        currentUserEmail = val.email;
        currentUserAccountID = val.accountID;
    },
});

let currentUserPersonalDetails;
Onyx.connect({
    key: ONYXKEYS.PERSONAL_DETAILS,
    callback: val => currentUserPersonalDetails = lodashGet(val, currentUserEmail),
});

/**
 * Returns the concatenated title for the PrimaryLogins of a report
 *
 * @param {Array} logins
 * @returns {string}
 */
function getReportParticipantsTitle(logins) {
    return _.map(logins, login => Str.removeSMSDomain(login)).join(', ');
}

/**
 * Check whether a report action is Attachment or not.
 * Ignore messages containing [Attachment] as the main content. Attachments are actions with only text as [Attachment].
 *
 * @param {Object} reportActionMessage report action's message as text and html
 * @returns {Boolean}
 */
function isReportMessageAttachment({text, html}) {
    return text === '[Attachment]' && html !== '[Attachment]';
}

/**
 * Given a collection of reports returns them sorted by last visited
 *
 * @param {Object} reports
 * @returns {Array}
 */
function sortReportsByLastVisited(reports) {
    return _.chain(reports)
        .toArray()
        .filter(report => report && report.reportID)
        .sortBy('lastVisitedTimestamp')
        .value();
}

/**
 * Can only edit if it's an ADDCOMMENT that is not an attachment,
 * the author is this user and it's not an optimistic response.
 * If it's an optimistic response comment it will not have a reportActionID,
 * and we should wait until it does before we show the actions
 *
 * @param {Object} reportAction
 * @returns {Boolean}
 */
function canEditReportAction(reportAction) {
    return reportAction.actorEmail === sessionEmail
        && reportAction.reportActionID
        && reportAction.actionName === CONST.REPORT.ACTIONS.TYPE.ADDCOMMENT
        && !isReportMessageAttachment(lodashGet(reportAction, ['message', 0], {}))
        && reportAction.pendingAction !== CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE;
}

/**
 * Can only delete if it's an ADDCOMMENT, the author is this user and it's not an optimistic response.
 * If it's an optimistic response comment it will not have a reportActionID,
 * and we should wait until it does before we show the actions
 *
 * @param {Object} reportAction
 * @returns {Boolean}
 */
function canDeleteReportAction(reportAction) {
    return reportAction.actorEmail === sessionEmail
        && reportAction.reportActionID
        && reportAction.actionName === CONST.REPORT.ACTIONS.TYPE.ADDCOMMENT
        && reportAction.pendingAction !== CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE;
}

/**
 * Whether the provided report is an Admin room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isAdminRoom(report) {
    return lodashGet(report, ['chatType'], '') === CONST.REPORT.CHAT_TYPE.POLICY_ADMINS;
}

/**
 * Whether the provided report is a Announce room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isAnnounceRoom(report) {
    return lodashGet(report, ['chatType'], '') === CONST.REPORT.CHAT_TYPE.POLICY_ANNOUNCE;
}

/**
 * Whether the provided report is a default room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isDefaultRoom(report) {
    return _.contains([
        CONST.REPORT.CHAT_TYPE.POLICY_ADMINS,
        CONST.REPORT.CHAT_TYPE.POLICY_ANNOUNCE,
        CONST.REPORT.CHAT_TYPE.DOMAIN_ALL,
    ], lodashGet(report, ['chatType'], ''));
}

/**
 * Whether the provided report is a Domain room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isDomainRoom(report) {
    return lodashGet(report, ['chatType'], '') === CONST.REPORT.CHAT_TYPE.DOMAIN_ALL;
}

/**
 * Whether the provided report is a user created policy room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isUserCreatedPolicyRoom(report) {
    return lodashGet(report, ['chatType'], '') === CONST.REPORT.CHAT_TYPE.POLICY_ROOM;
}

/**
 * Whether the provided report is a Policy Expense chat.
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isPolicyExpenseChat(report) {
    return lodashGet(report, ['chatType'], '') === CONST.REPORT.CHAT_TYPE.POLICY_EXPENSE_CHAT;
}

/**
 * Whether the provided report is a chat room
 * @param {Object} report
 * @param {String} report.chatType
 * @returns {Boolean}
 */
function isChatRoom(report) {
    return isUserCreatedPolicyRoom(report) || isDefaultRoom(report);
}

/**
 * Get the policy type from a given report
 * @param {Object} report
 * @param {String} report.policyID
 * @param {Object} policies must have Onyxkey prefix (i.e 'policy_') for keys
 * @returns {String}
 */
function getPolicyType(report, policies) {
    return lodashGet(policies, [`${ONYXKEYS.COLLECTION.POLICY}${report.policyID}`, 'type'], '');
}

/**
 * Given a collection of reports returns the most recently accessed one
 *
 * @param {Record<String, {lastVisitedTimestamp, reportID}>|Array<{lastVisitedTimestamp, reportID}>} reports
 * @param {Boolean} [ignoreDefaultRooms]
 * @param {Object} policies
 * @returns {Object}
 */
function findLastAccessedReport(reports, ignoreDefaultRooms, policies) {
    let sortedReports = sortReportsByLastVisited(reports);

    if (ignoreDefaultRooms) {
        sortedReports = _.filter(sortedReports, report => !isDefaultRoom(report) || getPolicyType(report, policies) === CONST.POLICY.TYPE.FREE);
    }

    return _.last(sortedReports);
}

/**
 * Whether the provided report is an archived room
 * @param {Object} report
 * @param {String} report.chatType
 * @param {Number} report.stateNum
 * @param {Number} report.statusNum
 * @returns {Boolean}
 */
function isArchivedRoom(report) {
    if (!isChatRoom(report) && !isPolicyExpenseChat(report)) {
        return false;
    }

    return report.statusNum === CONST.REPORT.STATUS.CLOSED && report.stateNum === CONST.REPORT.STATE_NUM.SUBMITTED;
}

/**
 * Get the policy name from a given report
 * @param {Object} report
 * @param {String} report.policyID
 * @param {String} report.oldPolicyName
 * @param {Object} policies must have Onyxkey prefix (i.e 'policy_') for keys
 * @returns {String}
 */
function getPolicyName(report, policies) {
    const defaultValue = report.oldPolicyName || Localize.translateLocal('workspace.common.unavailable');
    return lodashGet(policies, [`${ONYXKEYS.COLLECTION.POLICY}${report.policyID}`, 'name'], defaultValue);
}

/**
 * Get either the policyName or domainName the chat is tied to
 * @param {Object} report
 * @param {Object} policiesMap must have onyxkey prefix (i.e 'policy_') for keys
 * @returns {String}
 */
function getChatRoomSubtitle(report, policiesMap) {
    if (!isDefaultRoom(report) && !isUserCreatedPolicyRoom(report) && !isPolicyExpenseChat(report)) {
        return '';
    }
    if (report.chatType === CONST.REPORT.CHAT_TYPE.DOMAIN_ALL) {
        // The domainAll rooms are just #domainName, so we ignore the prefix '#' to get the domainName
        return report.reportName.substring(1);
    }
    if (isPolicyExpenseChat(report) && report.isOwnPolicyExpenseChat) {
        return Localize.translateLocal('workspace.common.workspace');
    }
    if (isArchivedRoom(report)) {
        return report.oldPolicyName;
    }
    return getPolicyName(report, policiesMap);
}

/**
 * Get welcome message based on room type
 * @param {Object} report
 * @param {Object} policiesMap must have Onyxkey prefix (i.e 'policy_') for keys
 * @returns {Object}
 */

function getRoomWelcomeMessage(report, policiesMap) {
    const welcomeMessage = {};
    const workspaceName = getPolicyName(report, policiesMap);

    if (isArchivedRoom(report)) {
        welcomeMessage.phrase1 = Localize.translateLocal('reportActionsView.begginningOfArchivedRoomPartOne');
        welcomeMessage.phrase2 = Localize.translateLocal('reportActionsView.begginningOfArchivedRoomPartTwo');
    } else if (isDomainRoom(report)) {
        welcomeMessage.phrase1 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryDomainRoomPartOne', {domainRoom: report.reportName});
        welcomeMessage.phrase2 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryDomainRoomPartTwo');
    } else if (isAdminRoom(report)) {
        welcomeMessage.phrase1 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryAdminRoomPartOne', {workspaceName});
        welcomeMessage.phrase2 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryAdminRoomPartTwo');
    } else if (isAnnounceRoom(report)) {
        welcomeMessage.phrase1 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryAnnounceRoomPartOne', {workspaceName});
        welcomeMessage.phrase2 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryAnnounceRoomPartTwo', {workspaceName});
    } else {
        // Message for user created rooms or other room types.
        welcomeMessage.phrase1 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryUserRoomPartOne');
        welcomeMessage.phrase2 = Localize.translateLocal('reportActionsView.beginningOfChatHistoryUserRoomPartTwo');
    }

    return welcomeMessage;
}

/**
 * Only returns true if this is our main 1:1 DM report with Concierge
 *
 * @param {Object} report
 * @returns {Boolean}
 */
function isConciergeChatReport(report) {
    return lodashGet(report, 'participants', []).length === 1
        && report.participants[0] === CONST.EMAIL.CONCIERGE;
}

/**
 * Returns true if Concierge is one of the chat participants (1:1 as well as group chats)
 * @param {Object} report
 * @returns {Boolean}
 */
function chatIncludesConcierge(report) {
    return report.participants
            && _.contains(report.participants, CONST.EMAIL.CONCIERGE);
}

/**
 * Returns true if there is any automated expensify account in emails
 * @param {Array} emails
 * @returns {Boolean}
 */
function hasExpensifyEmails(emails) {
    return _.intersection(emails, CONST.EXPENSIFY_EMAILS).length > 0;
}

/**
 * Whether the time row should be shown for a report.
 * @param {Array<Object>} personalDetails
 * @param {Object} report
 * @return {Boolean}
 */
function canShowReportRecipientLocalTime(personalDetails, report) {
    const reportParticipants = _.without(lodashGet(report, 'participants', []), sessionEmail);
    const participantsWithoutExpensifyEmails = _.difference(reportParticipants, CONST.EXPENSIFY_EMAILS);
    const hasMultipleParticipants = participantsWithoutExpensifyEmails.length > 1;
    const reportRecipient = personalDetails[participantsWithoutExpensifyEmails[0]];
    const reportRecipientTimezone = lodashGet(reportRecipient, 'timezone', CONST.DEFAULT_TIME_ZONE);
    return !hasMultipleParticipants
        && !isChatRoom(report)
        && reportRecipient
        && reportRecipientTimezone
        && reportRecipientTimezone.selected;
}

/**
 * Trim the last message text to a fixed limit.
 * @param {String} lastMessageText
 * @returns {String}
 */
function formatReportLastMessageText(lastMessageText) {
    return String(lastMessageText).substring(0, CONST.REPORT.LAST_MESSAGE_TEXT_MAX_LENGTH);
}

/**
 * Helper method to return a default avatar
 *
 * @param {String} [login]
 * @returns {String}
 */
function getDefaultAvatar(login = '') {
    // There are 8 possible default avatars, so we choose which one this user has based
    // on a simple hash of their login (which is converted from HEX to INT)
    const loginHashBucket = (parseInt(md5(login.toLowerCase()).substring(0, 4), 16) % 8) + 1;
    return `${CONST.CLOUDFRONT_URL}/images/avatars/avatar_${loginHashBucket}.png`;
}

/**
 * Returns the appropriate icons for the given chat report using the stored personalDetails.
 * The Avatar sources can be URLs or Icon components according to the chat type.
 *
 * @param {Object} report
 * @param {Object} personalDetails
 * @param {Object} policies
 * @param {*} [defaultIcon]
 * @returns {Array<*>}
 */
function getIcons(report, personalDetails, policies, defaultIcon = null) {
    if (!report) {
        return [defaultIcon || getDefaultAvatar()];
    }
    if (isArchivedRoom(report)) {
        return [Expensicons.DeletedRoomAvatar];
    }
    if (isDomainRoom(report)) {
        return [Expensicons.DomainRoomAvatar];
    }
    if (isAdminRoom(report)) {
        return [Expensicons.AdminRoomAvatar];
    }
    if (isAnnounceRoom(report)) {
        return [Expensicons.AnnounceRoomAvatar];
    }
    if (isChatRoom(report)) {
        return [Expensicons.ActiveRoomAvatar];
    }
    if (isPolicyExpenseChat(report)) {
        const policyExpenseChatAvatarSource = lodashGet(policies, [
            `${ONYXKEYS.COLLECTION.POLICY}${report.policyID}`, 'avatar',
        ]) || lodashGet(policies, [
            `${ONYXKEYS.COLLECTION.POLICY}${report.policyID}`, 'avatarURL',
        ]) || Expensicons.Workspace;

        // Return the workspace avatar if the user is the owner of the policy expense chat
        if (report.isOwnPolicyExpenseChat) {
            return [policyExpenseChatAvatarSource];
        }

        // If the user is an admin, return avatar source of the other participant of the report
        // (their workspace chat) and the avatar source of the workspace
        return [
            lodashGet(personalDetails, [report.ownerEmail, 'avatar']) || getDefaultAvatar(report.ownerEmail),
            policyExpenseChatAvatarSource,
        ];
    }

    // Return avatar sources for Group chats
    const sortedParticipants = _.map(report.participants, dmParticipant => ({
        firstName: lodashGet(personalDetails, [dmParticipant, 'firstName'], ''),
        avatar: lodashGet(personalDetails, [dmParticipant, 'avatar']) || getDefaultAvatar(dmParticipant),
    })).sort((first, second) => first.firstName - second.firstName);
    return _.map(sortedParticipants, item => item.avatar);
}

/**
 * Get the displayName for a single report participant.
 *
 * @param {Object} participant
 * @param {String} participant.displayName
 * @param {String} participant.firstName
 * @param {String} participant.login
 * @param {Boolean} [shouldUseShortForm]
 * @returns {String}
 */
function getDisplayNameForParticipant(participant, shouldUseShortForm = false) {
    if (!participant) {
        return '';
    }

    const loginWithoutSMSDomain = Str.removeSMSDomain(participant.login);
    let longName = participant.displayName || loginWithoutSMSDomain;
    if (Str.isSMSLogin(longName)) {
        longName = LocalePhoneNumber.toLocalPhone(preferredLocale, longName);
    }
    const shortName = participant.firstName || longName;

    return shouldUseShortForm ? shortName : longName;
}

/**
 * @param {Object} participants
 * @param {Boolean} isMultipleParticipantReport
 * @returns {Array}
 */
function getDisplayNamesWithTooltips(participants, isMultipleParticipantReport) {
    return _.map(participants, (participant) => {
        const displayName = getDisplayNameForParticipant(participant, isMultipleParticipantReport);
        const tooltip = Str.removeSMSDomain(participant.login);

        let pronouns = participant.pronouns;
        if (pronouns && pronouns.startsWith(CONST.PRONOUNS.PREFIX)) {
            const pronounTranslationKey = pronouns.replace(CONST.PRONOUNS.PREFIX, '');
            pronouns = Localize.translateLocal(`pronouns.${pronounTranslationKey}`);
        }

        return {
            displayName,
            tooltip,
            pronouns,
        };
    });
}

/**
 * Get the title for a report.
 *
 * @param {Object} report
 * @param {Object} [personalDetailsForParticipants]
 * @param {Object} [policies]
 * @returns {String}
 */
function getReportName(report, personalDetailsForParticipants = {}, policies = {}) {
    let formattedName;
    if (isChatRoom(report)) {
        formattedName = report.reportName;
    }

    if (isPolicyExpenseChat(report)) {
        const reportOwnerPersonalDetails = lodashGet(personalDetailsForParticipants, report.ownerEmail);
        const reportOwnerDisplayName = getDisplayNameForParticipant(reportOwnerPersonalDetails) || report.ownerEmail || report.reportName;
        formattedName = report.isOwnPolicyExpenseChat ? getPolicyName(report, policies) : reportOwnerDisplayName;
    }

    if (isArchivedRoom(report)) {
        formattedName += ` (${Localize.translateLocal('common.archived')})`;
    }

    if (formattedName) {
        return formattedName;
    }

    // Not a room or PolicyExpenseChat, generate title from participants
    const participants = _.without(lodashGet(report, 'participants', []), sessionEmail);
    const displayNamesWithTooltips = getDisplayNamesWithTooltips(
        _.isEmpty(personalDetailsForParticipants) ? participants : personalDetailsForParticipants,
        participants.length > 1,
    );
    return _.map(displayNamesWithTooltips, ({displayName}) => displayName).join(', ');
}

/**
 * Navigate to the details page of a given report
 *
 * @param {Object} report
 */
function navigateToDetailsPage(report) {
    const participants = lodashGet(report, 'participants', []);

    if (isChatRoom(report) || isPolicyExpenseChat(report)) {
        Navigation.navigate(ROUTES.getReportDetailsRoute(report.reportID));
        return;
    }
    if (participants.length === 1) {
        Navigation.navigate(ROUTES.getDetailsRoute(participants[0]));
        return;
    }
    Navigation.navigate(ROUTES.getReportParticipantsRoute(report.reportID));
}

/**
 * Generate a random reportID up to 53 bits aka 9,007,199,254,740,991 (Number.MAX_SAFE_INTEGER).
 * There were approximately 98,000,000 reports with sequential IDs generated before we started using this approach, those make up roughly one billionth of the space for these numbers,
 * so we live with the 1 in a billion chance of a collision with an older ID until we can switch to 64-bit IDs.
 *
 * In a test of 500M reports (28 years of reports at our current max rate) we got 20-40 collisions meaning that
 * this is more than random enough for our needs.
 *
 * @returns {Number}
 */
function generateReportID() {
    return (Math.floor(Math.random() * (2 ** 21)) * (2 ** 32)) + Math.floor(Math.random() * (2 ** 32));
}

/**
 * @param {Object} report
 * @returns {Boolean}
 */
function hasReportNameError(report) {
    return !_.isEmpty(lodashGet(report, 'errorFields.reportName', {}));
}

/**
 * Builds an optimistic IOU reportAction object
 *
 * @param {String} type - IOUReportAction type. Can be oneOf(create, decline, cancel, pay).
 * @param {Number} amount - IOU amount in cents.
 * @param {String} comment - User comment for the IOU.
 * @param {String} paymentType - Only required if the IOUReportAction type is 'pay'. Can be oneOf(elsewhere, payPal, Expensify).
 * @param {String} existingIOUTransactionID - Only required if the IOUReportAction type is oneOf(cancel, decline). Generates a randomID as default.
 * @param {Number} existingIOUReportID - Only required if the IOUReportActions type is oneOf(decline, cancel, pay). Generates a randomID as default.
 *
 * @returns {Object}
 */
function buildOptimisticIOUReportAction(type, amount, comment, paymentType = '', existingIOUTransactionID = '', existingIOUReportID = 0) {
    const currency = lodashGet(currentUserPersonalDetails, 'localCurrencyCode');
    const IOUTransactionID = existingIOUTransactionID || NumberUtils.rand64();
    const IOUReportID = existingIOUReportID || generateReportID();
    const sequenceNumber = NumberUtils.generateReportActionSequenceNumber();
    const originalMessage = {
        amount,
        comment,
        currency,
        IOUTransactionID,
        IOUReportID,
        type,
    };

    // We store amount, comment, currency in IOUDetails when type = pay
    if (type === CONST.IOU.REPORT_ACTION_TYPE.PAY) {
        _.each(['amount', 'comment', 'currency'], (key) => {
            delete originalMessage[key];
        });
        originalMessage.IOUDetails = {amount, comment, currency};
        originalMessage.paymentType = paymentType;
    }

    return {
        actionName: CONST.REPORT.ACTIONS.TYPE.IOU,
        actorAccountID: currentUserAccountID,
        actorEmail: currentUserEmail,
        automatic: false,
        avatar: lodashGet(currentUserPersonalDetails, 'avatar', getDefaultAvatar(currentUserEmail)),

        // For now, the clientID and sequenceNumber are the same.
        // We are changing that as we roll out the optimistiReportAction IDs and related refactors.
        clientID: sequenceNumber,
        isAttachment: false,
        originalMessage,
        person: [{
            style: 'strong',
            text: lodashGet(currentUserPersonalDetails, 'displayName', currentUserEmail),
            type: 'TEXT',
        }],
        reportActionID: NumberUtils.rand64(),
        sequenceNumber,
        shouldShow: true,
        timestamp: moment().unix(),
        pendingAction: CONST.RED_BRICK_ROAD_PENDING_ACTION.ADD,
    };
}

export {
    getReportParticipantsTitle,
    isReportMessageAttachment,
    findLastAccessedReport,
    canEditReportAction,
    canDeleteReportAction,
    sortReportsByLastVisited,
    isDefaultRoom,
    isAdminRoom,
    isAnnounceRoom,
    isUserCreatedPolicyRoom,
    isChatRoom,
    getChatRoomSubtitle,
    getPolicyName,
    getPolicyType,
    isArchivedRoom,
    isConciergeChatReport,
    hasExpensifyEmails,
    canShowReportRecipientLocalTime,
    formatReportLastMessageText,
    chatIncludesConcierge,
    isPolicyExpenseChat,
    getDefaultAvatar,
    getIcons,
    getRoomWelcomeMessage,
    getDisplayNamesWithTooltips,
    getReportName,
    navigateToDetailsPage,
    generateReportID,
    hasReportNameError,
    buildOptimisticIOUReportAction,
};
