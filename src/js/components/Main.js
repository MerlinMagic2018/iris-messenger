import MainTemplate from './MainTemplate.js';
import Translation, { translate as t } from '../services/Translation.js';
import Helpers from '../Helpers.js';
import PeerManager from '../services/PeerManager.js';
import Notifications from '../services/Notifications.js';
import VideoCall from './VideoCall.js';
import Gallery from './Gallery.js';
import Session from '../services/Session.js';
import Settings from './Settings.js';

Gun.log.off = true;
var gunOpts = { peers: PeerManager.getRandomPeers(), localStorage: false, retry:Infinity };
if (!iris.util.isElectron) {
  gunOpts.store = RindexedDB(gunOpts);
}
var gun = Gun(gunOpts);
window.gun = gun;

Helpers.checkColorScheme();

var chats = window.chats = {};
var autolinker = new Autolinker({ stripPrefix: false, stripTrailingSlash: false});
var activeChat;
var activeProfile;

if (iris.util.isElectron) {
  function refreshUnlessActive() { // hacky way to make sure that gun resubscribes multicast on network changes
    if (!Session.areWeOnline) { // if you haven't been active in the window in the last 60 seconds
      location.reload();
    }
  }
  window.addEventListener('online',  refreshUnlessActive);
}

var main_content_temp = _.template(MainTemplate);
$('body').prepend($('<div>').attr('id', 'main-content').html(main_content_temp(Translation.translation)));
Session.init();
Translation.init();
PeerManager.init();
Gallery.init();
Settings.init();

$(window).load(() => {
  $('body').css('opacity', 1); // use opacity because setting focus on display: none elements fails
});

Helpers.showConsoleWarning();

var emojiButton = $('#emoji-picker');
if (!iris.util.isMobile) {
  emojiButton.show();
  var picker = new EmojiButton({position: 'top-start'});

  picker.on('emoji', emoji => {
    $('#new-msg').val($('#new-msg').val() + emoji);
    $('#new-msg').focus();
  });

  emojiButton.click(event => {
    event.preventDefault();
    picker.pickerVisible ? picker.hidePicker() : picker.showPicker(emojiButton);
  });
}

$('#desktop-application-about').toggle(!iris.util.isMobile && !iris.util.isElectron);

$('#paste-chat-link').on('input', event => {
  var val = $(event.target).val();
  if (val.length < 30) {
    return;
  }
  var s = val.split('?');
  if (s.length !== 2) { return; }
  var chatId = Helpers.getUrlParameter('chatWith', s[1]) || Helpers.getUrlParameter('channelId', s[1]);
  if (chatId) {
    newChat(chatId, val);
    showChat(chatId);
  }
  $(event.target).val('');
});

$('#new-group-create').click(createGroup);
function createGroup(e) {
  e.preventDefault();
  if ($('#new-group-name').val().length) {
    var c = new iris.Channel({
      gun,
      key: Session.key,
      participants: [],
    });
    c.put('name', $('#new-group-name').val());
    $('#new-group-name').val('');
    addChat(c);
    showProfile(c.uuid);
  }
}

$('.chat-item.new').click(showNewChat);

function resetView() {
  if (activeChat) {
    chats[activeChat].setTyping(false);
  }
  activeChat = null;
  activeProfile = null;
  showMenu(false);
  cleanupScanner();
  $('#chatlink-qr-video').hide();
  $('.chat-item').toggleClass('active', false);
  $('.main-view').hide();
  $('#not-seen-by-them').hide();
  $(".message-form").hide();
  $("#header-content").empty();
  $("#header-content").css({cursor: null});
  $('#private-key-qr').remove();
  Gallery.reset();
}

function showMenu(show = true) {
  $('.sidebar').toggleClass('hidden-xs', !show);
  $('.main').toggleClass('hidden-xs', show);
}
$('#back-button').off().on('click', () => {
  resetView();
  showMenu(true);
});
$(window).resize(() => { // if resizing up from mobile size menu view
  if ($(window).width() > 565 && $('.main-view:visible').length === 0) {
    showNewChat();
  }
});

function showNewChat() {
  resetView();
  $('.chat-item.new').toggleClass('active', true);
  $('#new-chat').show();
  $("#header-content").text(t('new_chat'));
  $('#show-my-qr-btn').off().click(() => {
    $('#my-qr-code').toggle()
  })
}

var scanPrivKeyBtn = $('#scan-privkey-btn');
scanPrivKeyBtn.click(() => {
  if ($('#privkey-qr-video:visible').length) {
    $('#privkey-qr-video').hide();
    cleanupScanner();
  } else {
    $('#privkey-qr-video').show();
    startPrivKeyQRScanner();
  }
});

$('#scan-chatlink-qr-btn').click(() => {
  if ($('#chatlink-qr-video:visible').length) {
    $('#chatlink-qr-video').hide();
    cleanupScanner();
  } else {
    $('#chatlink-qr-video').show();
    startChatLinkQRScanner();
  }
});

function renderGroupPhotoSettings(uuid) {
  var me = chats[uuid].participantProfiles[key.pub];
  var isAdmin = !!(me && me.permissions && me.permissions.admin);
  $('#profile-group-settings').toggle(isAdmin);
  $('#current-profile-photo').toggle(!!chats[uuid].photo);
  $('#profile .profile-photo').toggle(!!chats[uuid].photo);
  if (isAdmin) {
    Helpers.setImgSrc($('#current-profile-photo'), chats[uuid].photo);
    $('#profile .profile-photo').hide();
    renderProfilePhotoSettings();
    var el = $('#profile-photo-settings');
    $('#profile-group-settings').prepend(el);
    $('#add-profile-photo').toggle(!chats[uuid].photo);
  }
}

var cropper;
function renderProfilePhotoSettings() {
  $('#profile-photo-error').toggleClass('hidden', true);
  var files = $('#profile-photo-input')[0].files;
  if (files && files.length) {
    var file = files[0];
    /*
    if (file.size > 1024 * 200) {
      $('#profile-photo-error').toggleClass('hidden', false);
      return console.error('file too big');
    }
    */
    // show preview
    $('#current-profile-photo').hide();
    $('#add-profile-photo').hide();
    Helpers.getBase64(file).then(base64 => {
      var previewEl = $('#profile-photo-preview');
      Helpers.setImgSrc(previewEl, base64);
      $('#profile-photo-preview').toggleClass('hidden', false);
      $('#cancel-profile-photo').toggleClass('hidden', false);
      $('#use-profile-photo').toggleClass('hidden', false);
      cropper = new Cropper(previewEl[0], {
        aspectRatio:1,
        autoCropArea: 1,
        viewMode: 1,
        background: false,
        zoomable: false
      });
    });
  } else {
    cropper && cropper.destroy();
    // show current profile photo
    if (!$('#current-profile-photo').attr('src')) {
      $('#add-profile-photo').show();
    }
    Helpers.setImgSrc($('#profile-photo-preview'), '');
    $('#cancel-profile-photo').toggleClass('hidden', true);
    $('#use-profile-photo').toggleClass('hidden', true);
  }
}
$('#current-profile-photo, #add-profile-photo').click(() => $('#profile-photo-input').click());
$('#profile-photo-input').change(e => {
  renderProfilePhotoSettings();
});
$('#use-profile-photo').click(() => {
  var canvas = cropper.getCroppedCanvas();
  var resizedCanvas = document.createElement('canvas');
  resizedCanvas.width = resizedCanvas.height = Math.min(canvas.width, 800);
  pica().resize(canvas, resizedCanvas).then(result => {
    var src = resizedCanvas.toDataURL('image/jpeg');
    // var src = $('#profile-photo-preview').attr('src');
    if (activeProfile) {
      chats[activeProfile].put('photo', src);
    } else {
      gun.user().get('profile').get('photo').put(src);
    }
    Helpers.setImgSrc($('#current-profile-photo'), src);
    $('#profile-photo-input').val('');
    renderProfilePhotoSettings();
  });
});
$('#cancel-profile-photo').click(() => {
  $('#profile-photo-input').val('');
  renderProfilePhotoSettings();
});
$('#remove-profile-photo').click(() => {
  if (activeProfile) {
    chats[activeProfile].put('photo', null);
  } else {
    gun.user().get('profile').get('photo').put(null);
  }
  renderProfilePhotoSettings();
});

function showProfile(pub) {
  if (!pub) {
    return;
  }
  resetView();
  activeProfile = pub;
  $('#profile .profile-photo-container').hide();
  var qrCodeEl = $('#profile-page-qr');
  qrCodeEl.empty();
  $('#profile-nickname-their').val('');
  $('#profile').show();
  addUserToHeader(pub);
  setTheirOnlineStatus(pub);
  renderGroupParticipants(pub);
  $('#profile .profile-photo').show();
  gun.user(pub).get('profile').get('photo').on(photo => {
    $('#profile .profile-photo-container').show();
    Helpers.setImgSrc($('#profile .profile-photo'), photo);
  });
  $('#profile .profile-about').toggle(chats[pub] && chats[pub].about && chats[pub].about.length > 0);
  $('#profile .profile-about-content').empty();
  $('#profile .profile-about-content').text(chats[pub] && chats[pub].about);
  const link = chats[pub] && chats[pub].getSimpleLink();
  $('#profile .add-friend').off().on('click', () => {
    console.log('add friend');
  });
  $('#profile .delete-chat').off().on('click', () => deleteChat(pub));
  $("input[name=notificationPreference][value=" + chats[pub].notificationSetting + "]").attr('checked', 'checked');
  $('input:radio[name=notificationPreference]').off().on('change', (event) => {
    chats[pub].put('notificationSetting', event.target.value);
  });
  $('#profile .send-message').off().on('click', () => showChat(pub));
  $('#profile .copy-user-link').off().on('click', event => {
    Helpers.copyToClipboard(link);
    var t = $(event.target);
    var originalText = t.text();
    var originalWidth = t.width();
    t.width(originalWidth);
    t.text('Copied');
    setTimeout(() => {
      t.text(originalText);
      t.css('width', '');
    }, 2000);
  });
  $('#profile-group-name').not(':focus').val(chats[pub] && chats[pub].name);
  $('#profile-group-name').off().on('input', event => {
    var name = event.target.value;
    chats[pub].put('name', name);
  });
  $('.profile-nicknames').toggle(pub !== (Session.key && Session.key.pub));
  $('#profile-nickname-my-container').toggle(!chats[pub].uuid);
  $('#profile-nickname-their').not(':focus').val(chats[pub] && chats[pub].theirNickname);
  $('#profile-nickname-my').text(chats[pub] && chats[pub].myNickname && chats[pub].myNickname.length ? chats[pub].myNickname : '');
  $('#profile-nickname-their').off().on('input', event => {
    var nick = event.target.value;
    chats[pub].put('nickname', nick);
  });
  qrCodeEl.empty();
  var qrcode = new QRCode(qrCodeEl[0], {
    text: link,
    width: 300,
    height: 300,
    colorDark : "#000000",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
  if (chats[pub] && chats[pub].uuid) {
    renderGroupPhotoSettings(chats[pub].uuid);
    $('#profile .profile-photo-container').show();
    Helpers.setImgSrc($('#profile .profile-photo'), chats[pub].photo);
  }
}

var newGroupParticipant;
$('#profile-add-participant').on('input', event => {
  var val = $(event.target).val();
  if (val.length < 30) {
    return;
  }
  var s = val.split('?');
  if (s.length !== 2) { return; }
  var pub = Helpers.getUrlParameter('chatWith', s[1]);
  $('#profile-add-participant-input').hide();
  if (pub) {
    $('#profile-add-participant-candidate').remove();
    var identicon = Helpers.getIdenticon(pub, 40).css({'margin-right':15});
    var nameEl = $('<span>');
    gun.user(pub).get('profile').get('name').on(name => nameEl.text(name));
    var el = $('<p>').css({display:'flex', 'align-items': 'center'}).attr('id', 'profile-add-participant-candidate');
    var addBtn = $('<button>').css({'margin-left': 15}).text('Add').click(() => {
      if (newGroupParticipant) {
        chats[activeProfile].addParticipant(newGroupParticipant);
        newGroupParticipant = null;
        $('#profile-add-participant-input').val('').show();
        $('#profile-add-participant-candidate').remove();
      }
    });
    var removeBtn = $('<button>').css({'margin-left': 15}).text('Cancel').click(() => {
      el.remove();
      $('#profile-add-participant-input').val('').show();
      newGroupParticipant = null;
    });
    el.append(identicon);
    el.append(nameEl);
    el.append(addBtn);
    el.append(removeBtn);
    newGroupParticipant = pub;
    $('#profile-add-participant-input').after(el);
  }
  $(event.target).val('');
});

function renderGroupParticipants(pub) {
  if (!(chats[pub] && chats[pub].uuid)) {
    $('#profile-group-settings').hide();
    return;
  } else {
    $('#profile-group-settings').show();
  }
  $('#profile-group-participants').empty();
  var keys = Object.keys(chats[pub].participantProfiles);
  var me = chats[pub].participantProfiles[key.pub];
  if (me && me.permissions) {
    $('#profile-add-participant').toggle(me.permissions.admin);
    $('#profile-group-name-container').toggle(me.permissions.admin);
  }
  keys.forEach(k => {
    var profile = chats[pub].participantProfiles[k];
    var identicon = Helpers.getIdenticon(k, 40).css({'margin-right':15});
    var nameEl = $('<span>');
    gun.user(k).get('profile').get('name').on(name => nameEl.text(name));
    var el = $('<p>').css({display:'flex', 'align-items': 'center', 'cursor':'pointer'});
    var removeBtn = $('<button>').css({'margin-right': 15}).text('Remove').click(() => {
      el.remove();
      // TODO remove group participant
    });
    //el.append(removeBtn);
    el.append(identicon);
    el.append(nameEl);
    if (profile.permissions && profile.permissions.admin) {
      el.append($('<small>').text('admin').css({'margin-left': 5}));
    }
    el.click(() => showProfile(k));
    $('#profile-group-participants').append(el);
  });
}

function addUserToHeader(pub) {
  $('#header-content').empty();
  var nameEl = $('<div class="name"></div>');
  if (pub === (Session.key && Session.key.pub) && activeProfile !== pub) {
    nameEl.html("📝<b>Note to Self</b>");
  } else if (chats[pub]) {
    nameEl.text(getDisplayName(pub));
  }
  nameEl.show();

  var identicon = Helpers.getIdenticon(pub, 40);
  var img = identicon.children('img').first();
  img.attr('height', 40).attr('width', 40);
  $("#header-content").append($('<div>').addClass('identicon-container').append(identicon));
  var textEl = $('<div>').addClass('text');
  textEl.append(nameEl);
  if (chats[pub] && chats[pub].uuid) {
    var t = Object.keys(chats[pub].participantProfiles).map(p => chats[pub].participantProfiles[p].name).join(', ');
    var namesEl = $('<small>').addClass('participants').text(t);
    textEl.append(namesEl);
    if (chats[pub].photo) {
      identicon.hide();
      var photo = Helpers.setImgSrc($('<img>'), chats[pub].photo).attr('height', 40).attr('width', 40).css({'border-radius': '50%'});
      $('#header-content .identicon-container').append(photo);
    }
  }
  textEl.append($('<small>').addClass('last-seen'));
  textEl.append($('<small>').addClass('typing-indicator').text('typing...'));
  $("#header-content").append(textEl);
  textEl.on('click', () => showProfile(pub));
  var videoCallBtn = $(`<a class="tooltip"><span class="tooltiptext">Video call</span><svg enable-background="new 0 0 50 50" id="Layer_1" version="1.1" viewBox="0 0 50 50" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect fill="none" style="height:24px;width:24px"/><polygon fill="none" points="49,14 36,21 36,29   49,36 " stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="4"/><path d="M36,36c0,2.209-1.791,4-4,4  H5c-2.209,0-4-1.791-4-4V14c0-2.209,1.791-4,4-4h27c2.209,0,4,1.791,4,4V36z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="4"/></svg></a>`).attr('id', 'start-video-call').css({width:24, height:24, color: 'var(--msg-form-button-color)'});
  videoCallBtn.click(() => VideoCall.callingInterval ? null : VideoCall.callUser(pub));
  var voiceCallBtn = $('<a><svg enable-background="new 0 0 50 50" style="height:20px;width:20px" id="Layer_1" version="1.1" viewBox="0 0 50 50" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect fill="none" height="50" width="50"/><path d="M30.217,35.252c0,0,4.049-2.318,5.109-2.875  c1.057-0.559,2.152-0.7,2.817-0.294c1.007,0.616,9.463,6.241,10.175,6.739c0.712,0.499,1.055,1.924,0.076,3.32  c-0.975,1.396-5.473,6.916-7.379,6.857c-1.909-0.062-9.846-0.236-24.813-15.207C1.238,18.826,1.061,10.887,1,8.978  C0.939,7.07,6.459,2.571,7.855,1.595c1.398-0.975,2.825-0.608,3.321,0.078c0.564,0.781,6.124,9.21,6.736,10.176  c0.419,0.66,0.265,1.761-0.294,2.819c-0.556,1.06-2.874,5.109-2.874,5.109s1.634,2.787,7.16,8.312  C27.431,33.615,30.217,35.252,30.217,35.252z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="4"/></svg></a>').css({width:20, height:20, 'margin-right': 20});
  voiceCallBtn.click(() => VideoCall.callingInterval ? VideoCall.stopCalling(pub) : VideoCall.callUser(pub));
  //$("#header-content").append(voiceCallBtn);
  $("#header-content").append(videoCallBtn);
  $("#header-content").css({cursor: 'pointer'});
}

function setTheirOnlineStatus(pub) {
  if (!chats[pub]) return;
  var online = chats[pub].online;
  if (online && (activeChat === pub || activeProfile === pub)) {
    if (online.isOnline) {
      $('#header-content .last-seen').text('online');
    } else if (online.lastActive) {
      var d = new Date(online.lastActive);
      var lastSeenText = iris.util.getDaySeparatorText(d, d.toLocaleDateString({dateStyle:'short'}));
      if (lastSeenText === 'today') {
        lastSeenText = iris.util.formatTime(d);
      } else {
        lastSeenText = iris.util.formatDate(d);
      }
      $('#header-content .last-seen').text('last active ' + lastSeenText);
    }
  }
}

function showChat(pub) {
  if (!pub) {
    return;
  }
  resetView();
  activeChat = pub;
  if (!Object.prototype.hasOwnProperty.call(chats, pub)) {
    newChat(pub);
  }
  var chatListEl = $('.chat-item[data-pub="' + pub +'"]');
  chatListEl.toggleClass('active', true);
  chatListEl.find('.unseen').empty().hide();
  $("#message-list").empty();
  $("#message-view").show();
  $(".message-form").show();
  if (!iris.util.isMobile) {
    $("#new-msg").focus();
  }
  var isTyping = false;
  var getIsTyping = () => $('#new-msg').val().length > 0;
  var setTyping = () => chats[pub].setTyping(getIsTyping());
  var setTypingThrottled = _.throttle(setTyping, 1000);
  $('#new-msg').val(chats[pub].msgDraft);
  $('#new-msg').off().on('input', () => {
    if (isTyping === getIsTyping()) {
      setTypingThrottled();
    } else {
      setTyping();
    }
    isTyping = getIsTyping();
    chats[pub].msgDraft = $('#new-msg').val();
  });
  $(".message-form form").off().on('submit', event => {
    event.preventDefault();
    chats[pub].msgDraft = null;
    var text = $('#new-msg').val();
    if (!text.length && !chats[pub].attachments) { return; }
    chats[pub].setTyping(false);
    var msg = {text};
    if (chats[pub].attachments) {
      msg.attachments = chats[pub].attachments;
    }
    chats[pub].send(msg);
    Gallery.closeAttachmentsPreview();
    $('#new-msg').val('');
  });
  Notifications.changeChatUnseenCount(pub, 0);
  addUserToHeader(pub);
  var msgs = Object.values(chats[pub].messages);
  msgs.forEach(msg => addMessage(msg, pub));
  sortMessagesByTime();
  $('#message-view').scroll(() => {
    if ($('#attachment-preview:visible').length) { return; }
    var scrollPosition = $('#message-view').scrollTop();
    var currentDaySeparator = $('.day-separator').last();
    var pos = currentDaySeparator.position();
    while (currentDaySeparator && pos && pos.top - 55 > 0) {
      currentDaySeparator = currentDaySeparator.prevAll('.day-separator').first();
      pos = currentDaySeparator.position();
    }
    var s = currentDaySeparator.clone();
    var center = $('<div>').css({position: 'fixed', top: 70, 'text-align': 'center'}).attr('id', 'floating-day-separator').width($('#message-view').width()).append(s);
    $('#floating-day-separator').remove();
    setTimeout(() => s.fadeOut(), 2000);
    $('#message-view').prepend(center);
  });
  lastSeenTimeChanged(pub);
  chats[pub].setMyMsgsLastSeenTime();
  Helpers.scrollToMessageListBottom();
  chats[pub].setMyMsgsLastSeenTime();
  setTheirOnlineStatus(pub);
  setDeliveredCheckmarks(pub);
}

var sortChatsByLatest = _.throttle(() => {
  var sorted = $(".chat-item:not(.new)").sort((a, b) => {
    return ($(b).data('latestTime') || -Infinity) - ($(a).data('latestTime') || -Infinity);
  });
  $(".chat-list").append(sorted);
}, 100);

function sortMessagesByTime() {
  var sorted = $(".msg").sort((a, b) => $(a).data('time') - $(b).data('time'));
  $("#message-list").append(sorted);
  $('.day-separator').remove();
  $('.from-separator').remove();
  var now = new Date();
  var nowStr = now.toLocaleDateString();
  var previousDateStr;
  var previousFrom;
  sorted.each(function() {
    var date = $(this).data('time');
    if (!date) { return; }
    var dateStr = date.toLocaleDateString();
    if (dateStr !== previousDateStr) {
      var separatorText = iris.util.getDaySeparatorText(date, dateStr, now, nowStr);
      $(this).before($('<div>').text(separatorText).addClass('day-separator'));
    }
    previousDateStr = dateStr;

    var from = $(this).data('from');
    if (previousFrom && (from !== previousFrom)) {
      $(this).before($('<div>').addClass('from-separator'));
      $(this).find('small').show();
    } else {
      $(this).find('small').hide();
    }
    previousFrom = from;
  });
}

var seenIndicatorHtml = '<span class="seen-indicator"><svg version="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 59 42"><polygon fill="currentColor" points="40.6,12.1 17,35.7 7.4,26.1 4.6,29 17,41.3 43.4,14.9"></polygon><polygon class="iris-delivered-checkmark" fill="currentColor" points="55.6,12.1 32,35.7 29.4,33.1 26.6,36 32,41.3 58.4,14.9"></polygon></svg></span>';

function addMessage(msg, chatId) {
  var escaped = $('<div>').text(msg.text).html();
  var textEl = $('<div class="text"></div>').html(autolinker.link(escaped));
  var seenHtml = msg.selfAuthored ? ' ' + seenIndicatorHtml : '';
  var msgContent = $(
    '<div class="msg-content"><div class="time">' + iris.util.formatTime(msg.time) + seenHtml + '</div></div>'
  );
  msgContent.prepend(textEl);
  if (msg.attachments) {
    msg.attachments.forEach(a => {
      if (a.type.indexOf('image') === 0 && a.data) {
        var img = Helpers.setImgSrc($('<img>'), a.data).click(e => { Gallery.openAttachmentsGallery(msg, e); });
        msgContent.prepend(img);
        img.one('load', Helpers.scrollToMessageListBottom);
      }
    })
  }
  if (chats[chatId].uuid && !msg.info.selfAuthored) {
    var profile = chats[chatId].participantProfiles[msg.info.from];
    var name = profile && profile.name;
    if (name) {
      var nameEl = $('<small>').click(() => addMention(name)).text(name).css({color: profile.color}).addClass('msgSenderName');
      msgContent.prepend(nameEl);
    }
  }
  if (msg.text.length === 2 && Helpers.isEmoji(msg.text)) {
    textEl.toggleClass('emoji-only', true);
  } else {
    textEl.html(Helpers.highlightEmoji(textEl.html()));
  }
  const msgEl = $('<div class="msg"></div>').append(msgContent);
  msgEl.data('time', msg.time);
  msgEl.data('from', msg.info.from);
  msgEl.toggleClass('our', msg.selfAuthored ? true : false);
  msgEl.toggleClass('their', msg.selfAuthored ? false : true);
  $("#message-list").append(msgEl); // TODO: jquery insertAfter element with smaller timestamp
}

function deleteChat(pub) {
  iris.Channel.deleteChannel(gun, Session.key, pub);
  if (activeChat === pub) {
    showNewChat();
    showMenu();
  }
  delete chats[pub];
  $('.chat-item[data-pub="' + pub +'"]').remove();
}

function addMention(name) {
  $('#new-msg').val($('#new-msg').val().trim() + ` @${name} `);
  $('#new-msg').focus();
}

function getDisplayName(pub) {
  var displayName;
  if (chats[pub].theirNickname && chats[pub].theirNickname.length) {
    displayName = chats[pub].theirNickname;
    if (chats[pub].name && chats[pub].name.length) {
      displayName = displayName + ' (' + chats[pub].name + ')';
    }
  } else {
    displayName = chats[pub].name;
  }
  return displayName || '';
}

function newChat(pub, chatLink) {
  if (!pub || Object.prototype.hasOwnProperty.call(chats, pub)) {
    return;
  }
  const channel = new iris.Channel({gun, key: Session.key, chatLink: chatLink, participants: pub});
  addChat(channel);
}

function addChat(channel) {
  var pub = channel.getId();
  if (chats[pub]) { return; }
  chats[pub] = channel;
  $('#welcome').remove();
  var el = $('<div class="chat-item"><div class="text"><div><span class="name"></span><small class="latest-time"></small></div> <small class="typing-indicator"></small> <small class="latest"></small> <span class="unseen"></span></div></div>');
  el.attr('data-pub', pub);
  var latestEl = el.find('.latest');
  var typingIndicator = el.find('.typing-indicator').text('Typing...');
  chats[pub].getMessages((msg, info) => {
    chats[pub].messages[msg.time] = msg;
    msg.info = info;
    msg.selfAuthored = info.selfAuthored;
    msg.time = new Date(msg.time);
    if (!info.selfAuthored && msg.time > (chats[pub].myLastSeenTime || -Infinity)) {
      if (activeChat !== pub || document.visibilityState !== 'visible') {
        Notifications.changeChatUnseenCount(pub, 1);
      }
    }
    if (!info.selfAuthored && msg.time > chats[pub].theirLastSeenTime) {
      chats[pub].theirLastSeenTime = msg.time;
      lastSeenTimeChanged(pub);
    }
    if (!chats[pub].latest || msg.time > chats[pub].latest.time) {
      chats[pub].latest = msg;
      var text = msg.text || '';
      if (msg.attachments) {
        text = '[attachment]' + (text.length ? ': ' + text : '');
      } else {
        text = msg.text;
      }
      if (chats[pub].uuid && !msg.selfAuthored && msg.info.from && chats[pub].participantProfiles[msg.info.from].name) {
        text = chats[pub].participantProfiles[msg.info.from].name + ': ' + text;
      }
      var now = new Date();
      var latestTimeText = iris.util.getDaySeparatorText(msg.time, msg.time.toLocaleDateString({dateStyle:'short'}));
      if (latestTimeText === 'today') { latestTimeText = iris.util.formatTime(msg.time); }
      latestEl.text(text);
      latestEl.html(Helpers.highlightEmoji(latestEl.html()));
      if (info.selfAuthored) {
        latestEl.prepend($(seenIndicatorHtml));
        setLatestSeen(pub);
        setLatestCheckmark(pub);
      }
      el.find('.latest-time').text(latestTimeText);
      el.data('latestTime', msg.time);
      sortChatsByLatest();
    }
    if (activeChat === pub) {
      addMessage(msg, pub);
      sortMessagesByTime(); // this is slow if message history is loaded while chat active
      if (chats[pub].latest.time === msg.time && Session.areWeOnline) {
        chats[pub].setMyMsgsLastSeenTime();
      }
      if (chats[pub].theirLastSeenTime) {
        $('#not-seen-by-them').slideUp();
      } else if (!chats[pub].uuid) {
        $('#not-seen-by-them').slideDown();
      }
      Helpers.scrollToMessageListBottom();
    }
    Notifications.notifyMsg(msg, info, pub);
  });
  Notifications.changeChatUnseenCount(pub, 0);
  chats[pub].messages = chats[pub].messages || [];
  chats[pub].identicon = Helpers.getIdenticon(pub, 49);
  el.prepend($('<div>').addClass('identicon-container').append(chats[pub].identicon));
  chats[pub].onTheir('nickname', (nick) => {
    chats[pub].myNickname = nick;
    $('#profile-nickname-my').text(nick && nick.length ? nick : '');
    $('#profile-nickname-my-container').toggle(!!(nick && nick.length));
  });
  chats[pub].onMy('nickname', (nick) => {
    chats[pub].theirNickname = nick;
    if (pub !== Session.key.pub) {
      el.find('.name').text(Helpers.truncateString(getDisplayName(pub), 20));
    }
    if (pub === activeChat || pub === activeProfile) {
      addUserToHeader(pub);
    }
  });
  chats[pub].notificationSetting = 'all';
  chats[pub].onMy('notificationSetting', (val) => {
    chats[pub].notificationSetting = val;
    if (pub === activeProfile) {
      $("input[name=notificationPreference][value=" + val + "]").attr('checked', 'checked');
    }
  });
  el.click(() => showChat(pub));
  $(".chat-list").append(el);
  chats[pub].getTheirMsgsLastSeenTime(time => {
    if (chats[pub]) {
      chats[pub].theirLastSeenTime = new Date(time);
      lastSeenTimeChanged(pub);
    }
  });
  chats[pub].getMyMsgsLastSeenTime(time => {
    chats[pub].myLastSeenTime = new Date(time);
    if (chats[pub].latest && chats[pub].myLastSeenTime >= chats[pub].latest.time) {
      Notifications.changeChatUnseenCount(pub, 0);
    }
    PeerManager.askForPeers(pub); // TODO: this should be done only if we have a chat history or friendship with them
  });
  chats[pub].getTyping(isTyping => {
    if (activeChat === pub) {
      $('#header-content .last-seen').toggle(!isTyping);
      $('#header-content .typing-indicator').toggle(isTyping);
    }
    typingIndicator.toggle(isTyping);
    latestEl.toggle(!isTyping);
  });
  chats[pub].online = {};
  iris.Channel.getOnline(gun, pub, (online) => {
    if (chats[pub]) {
      chats[pub].online = online;
      setTheirOnlineStatus(pub);
      setDeliveredCheckmarks(pub);
    }
  });
  function setName(name, from) {
    if (chats[pub].uuid) {
      var profile = chats[pub].participantProfiles[from];
      if (profile && !(profile.permissions && profile.permissions.admin)) {
        return;
      }
    }
    if (name && typeof name === 'string') {
      chats[pub].name = name;
    }
    if (pub === (Session.key && Session.key.pub)) {
      el.find('.name').html("📝<b>Note to Self</b>");
    } else {
      el.find('.name').text(Helpers.truncateString(getDisplayName(pub), 20));
    }
    if (pub === activeChat || pub === activeProfile) {
      addUserToHeader(pub);
    }
    if (pub === activeProfile) {
      $('#profile-group-name').not(':focus').val(name);
    }
  }
  function setAbout(about) {
    chats[pub].about = about;
    if (activeProfile === pub) {
      $('#profile .profile-about').toggle(about && about.length > 0);
      $('#profile .profile-about-content').text(about);
    }
  }
  function setGroupPhoto(photo, from) {
    var profile = chats[pub].participantProfiles[from];
    if (profile && !(profile.permissions && profile.permissions.admin)) {
      return;
    }
    chats[pub].photo = photo;
    el.find('.identicon-container').empty();
    var img = Helpers.setImgSrc($('<img>'), photo).attr('height', 49).attr('width', 49).css({'border-radius': '50%'});
    el.find('.identicon-container').append(photo ? img : chats[pub].identicon);
    if (pub === activeChat || pub === activeProfile) {
      addUserToHeader(pub);
    }
    if (pub === activeProfile) {
      Helpers.setImgSrc($('#current-profile-photo'), photo);
      Helpers.setImgSrc($('#profile .profile-photo'), photo);
    }
    $('#current-profile-photo').toggle(!!photo);
  }
  if (chats[pub].uuid) {
    chats[pub].on('name', setName);
    chats[pub].on('about', setAbout);
    chats[pub].on('photo', setGroupPhoto);
    chats[pub].participantProfiles = {};
    var participants = chats[pub].getParticipants();
    chats[pub].onMy('participants', participants => {
      if (typeof participants === 'object') {
        var keys = Object.keys(participants);
        keys.forEach((k, i) => {
          if (chats[pub].participantProfiles[k]) { return; }
          var hue = 360 / Math.max(keys.length, 2) * i; // TODO use css filter brightness
          chats[pub].participantProfiles[k] = {permissions: participants[k], color: `hsl(${hue}, 98%, ${isDarkMode ? 80 : 33}%)`};
          gun.user(k).get('profile').get('name').on(name => {
            chats[pub].participantProfiles[k].name = name;
          });
        });
      }
      if (activeProfile === pub) {
        renderGroupParticipants(pub);
      }
      if (activeChat === pub) {
        addUserToHeader(pub);
      }
    });
    var isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    gun.user(pub).get('profile').get('name').on(setName);
    gun.user(pub).get('profile').get('about').on(setAbout);
  }
  chats[pub].onTheir('call', call => VideoCall.onCallMessage(pub, call));
}

function setLatestSeen(pub) {
  if (chats[pub].latest) {
    $('.chat-item[data-pub="' + pub +'"]').toggleClass('seen', chats[pub].latest.time <= chats[pub].theirLastSeenTime);
  }
}

function setLatestCheckmark(pub) {
  var latestTime = chats[pub].latest && chats[pub].latest.time;
  var lastActive = chats[pub].online && chats[pub].online.lastActive && new Date(chats[pub].online.lastActive);
  if (latestTime && lastActive) {
    $('.chat-item[data-pub="' + pub +'"]').toggleClass('delivered', latestTime <= lastActive);
  }
}

function setDeliveredCheckmarks(pub) {
  var online = chats[pub].online;
  if (online && online.lastActive) {
    var lastActive = new Date(online.lastActive);
    if (activeChat === pub) {
      $('.msg.our:not(.delivered)').each(function() {
        var el = $(this);
        if (el.data('time') <= lastActive) {
          el.toggleClass('delivered', true);
        }
      });
    }
    setLatestCheckmark(pub);
  }
}

function lastSeenTimeChanged(pub) {
  setLatestSeen(pub);
  setDeliveredCheckmarks(pub);
  if (pub === activeChat) {
    if (chats[pub].theirLastSeenTime) {
      $('#not-seen-by-them').slideUp();
      $('.msg.our:not(.seen)').each(function() {
        var el = $(this);
        if (el.data('time') <= chats[pub].theirLastSeenTime) {
          el.toggleClass('seen', true);
        }
      });
      // set seen msgs
    } else {
      if (!chats[pub].uuid && $('.msg.our').length) {
        $('#not-seen-by-them').slideDown();
      }
    }
  }
}

export {gun, chats, activeChat, activeProfile, resetView, addChat, showNewChat};