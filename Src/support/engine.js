const MAX_MESSAGE_LENGTH = 1800;

export function normalizeSupportText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HELP_CUES = [
  "cho minh hoi", "cho hoi", "cho tui hoi", "hoi chut", "hoi xiu",
  "co ai biet", "ai biet", "anyone know", "can someone", "does anyone",
  "help", "need help", "need some help", "giup minh", "giup voi",
  "can giup", "minh can", "can hoi", "ai giup", "chi minh", "xin giup",
  "ho tro", "support", "lam sao", "the nao", "cach nao", "tai sao",
  "vi sao", "sao lai", "khong hieu", "minh bi", "toi bi", "i need",
  "how do i", "how can i", "how to", "where can i", "where is", "where are", "where do i", "what is", "what are", "can i", "is there", "do i need", "why does",
  "why is", "it does not work", "doesnt work", "not working",
  "cant", "can t", "cannot", "can not", "unable to", "having trouble", "trouble with", "not sure how to", "issue with", "problem with"
];

const BROAD_TERMS = new Set([
  "discord", "music", "voice", "event", "rule", "rules", "feedback",
  "spotify", "apple music", "youtube music", "playlist", "state role",
  "access", "track"
]);

const CATEGORIES = [
  {
    key: "safety-report", priority: 100, staff: true,
    terms: ["bao cao", "report user", "report someone", "report spam", "report scam", "report abuse", "scam", "scammed", "got scammed", "someone scammed me", "lua dao", "spam", "quay roi", "bat nat", "harassment", "bullying", "doxx", "doxing", "threat", "de doa", "noi dung doc hai", "vi pham", "bi lua", "tai khoan gia"],
    vi: "🛡️ **Báo cáo an toàn**\nNếu có spam, lừa đảo, quấy rối hoặc nội dung nguy hiểm, đừng tranh cãi hay đăng thông tin riêng tư công khai. Hãy gửi link tin nhắn, ảnh bằng chứng và mô tả ngắn cho Moderator/Staff. Nếu có nguy cơ tức thời, báo Staff ngay.",
    en: "🛡️ **Safety report**\nFor spam, scams, harassment, threats, or harmful content, avoid engaging publicly. Send a message link, screenshots, and a short description to a Moderator/Staff member. Contact Staff immediately if someone may be in danger.",
    followVi: "Mày đang muốn báo cáo hành vi nào, và có link tin nhắn hoặc ảnh bằng chứng không?",
    followEn: "What are you reporting, and do you have a message link or screenshot?"
  },
  {
    key: "state-role", priority: 90,
    terms: ["chon bang", "tieu bang", "state role", "state selector", "doi bang", "xoa bang", "remove state", "change state", "select a state", "state panel", "bang nao", "role bang"],
    vi: "🗺️ **State Role / chọn bang**\nTìm bảng **State Selector**, mở menu đúng khu vực rồi chọn bang của mày. Chọn bang mới sẽ thay bang cũ; nút **REMOVE MY STATE** sẽ gỡ role. Nếu bảng không hiện hoặc chọn xong role không đổi, gửi ảnh màn hình để Staff kiểm tra.",
    en: "🗺️ **State roles**\nFind the **State Selector** panel, open the correct region menu, and choose your state. Selecting a new state replaces the old one. Use **REMOVE MY STATE** to clear it. If the panel is missing or the role does not update, share a screenshot with Staff.",
    followVi: "Mày không thấy bảng chọn, không chọn được bang, hay chọn rồi mà role không đổi?",
    followEn: "Is the panel missing, is the menu not working, or did the role fail to update?"
  },
  {
    key: "verification-access", priority: 85,
    terms: ["verify", "verification", "verified", "xac minh", "xac thuc", "captcha", "onboarding", "duyet thanh vien", "cap role", "nhan role", "role member", "access", "quyen truy cap", "khong vao duoc kenh", "cant see channel", "cannot see channel", "locked channel", "missing role", "no role"],
    vi: "🔐 **Xác minh / quyền truy cập**\nMở phòng hướng dẫn xác minh và làm lần lượt các bước được ghim. Sau khi hoàn tất, chờ một chút rồi tải lại Discord. Nếu vẫn thiếu role hoặc không thấy kênh, gửi tên kênh, bước đã hoàn thành và ảnh lỗi cho Staff. Tuyệt đối không gửi mật khẩu hay mã đăng nhập.",
    en: "🔐 **Verification / channel access**\nFollow the pinned verification steps in the verification channel. After completing them, wait briefly and refresh Discord. If a role or channel is still missing, tell Staff which step you completed and share a screenshot. Never share passwords or login codes.",
    followVi: "Mày đang kẹt ở bước xác minh nào, hay đã verify nhưng vẫn chưa thấy kênh?",
    followEn: "Are you stuck during verification, or have you verified but still cannot see a channel?"
  },
  {
    key: "voice-audio", priority: 80,
    terms: ["voice", "mic", "micro", "microphone", "tai nghe", "headphone", "headset", "loa", "speaker", "khong nghe", "khong ai nghe", "no sound", "cant hear", "can't hear", "no audio", "audio input", "audio output", "mic not", "microphone not", "bi re", "lag voice", "voice chat"],
    vi: "🎧 **Voice / âm thanh**\nKiểm tra đúng voice channel, Output Device và Input Device trong Discord → Voice & Video. Kiểm tra quyền micro của hệ điều hành, tắt thử Noise Suppression/Krisp nếu âm thanh bị cắt, rồi vào lại voice. Cho biết mày không nghe được, người khác không nghe mày, hay âm thanh bị rè.",
    en: "🎧 **Voice / audio**\nCheck the correct voice channel and your Input/Output Device under Discord → Voice & Video. Verify microphone permissions in your OS, temporarily test with Krisp/noise suppression off if audio is cutting out, then reconnect. Tell us whether you cannot hear others, others cannot hear you, or the audio is distorted.",
    followVi: "Lỗi nằm ở mic, loa/tai nghe, không vào được voice, hay bị rè/lag?",
    followEn: "Is the issue your microphone, speakers/headset, joining voice, or distorted/lagging audio?"
  },
  {
    key: "music-playback", priority: 75,
    terms: ["music", "phat nhac", "playlist", "spotify", "apple music", "youtube music", "song request", "track", "bai hat", "nghe nhac", "playback", "music bot", "streaming"],
    vi: "🎵 **Âm nhạc / phát nhạc**\nNói rõ mày đang muốn chia sẻ playlist, đề xuất bài hát hay gặp lỗi phát nhạc. Nếu là lỗi phát, cho biết bot/ứng dụng nào, voice channel nào và thông báo lỗi hiện ra. Nếu chỉ muốn giới thiệu nhạc, gửi tên bài hoặc link.",
    en: "🎵 **Music / playback**\nTell us whether you want to share a playlist, recommend a track, or troubleshoot playback. For playback issues, include the bot/app, voice channel, and exact error. For a music recommendation, share the track or link.",
    followVi: "Mày muốn chia sẻ nhạc hay đang gặp lỗi khi phát/nghe nhạc?",
    followEn: "Are you sharing music, or troubleshooting a playback/listening issue?"
  },
  {
    key: "discord-account", priority: 70,
    terms: ["discord", "crashing", "crashes", "keeps crashing", "tai khoan", "account", "dang nhap", "login", "password", "mat khau", "email", "nitro", "2fa", "two factor", "ma xac minh", "verification code", "bi hack", "hacked", "ban appeal", "disabled account"],
    vi: "🛠️ **Tài khoản / ứng dụng Discord**\nThử cập nhật Discord, đăng xuất rồi đăng nhập lại nếu vẫn truy cập được, và kiểm tra trang trạng thái Discord khi dịch vụ chập chờn. Nếu nghi tài khoản bị chiếm quyền, đổi mật khẩu và bật 2FA ngay. Không gửi mật khẩu, email riêng tư hoặc mã xác thực vào server.",
    en: "🛠️ **Discord account / app**\nUpdate Discord, restart the app, and check Discord's service status if things seem unavailable. If your account may be compromised, change your password and enable 2FA immediately. Never post passwords, private email details, or verification codes in the server.",
    followVi: "Mày gặp lỗi đăng nhập, tài khoản bị khóa/hack, hay ứng dụng Discord bị lỗi?",
    followEn: "Is this a login issue, a locked/compromised account, or the Discord app malfunctioning?"
  },
  {
    key: "server-rules", priority: 78,
    terms: ["noi quy", "rules", "rule", "quy dinh", "luat server", "warning", "canh cao", "mute", "kick", "bi ban", "banned", "bi cam", "appeal", "khieu nai", "appeal ban", "bi phat"],
    vi: "📜 **Nội quy / xử lý vi phạm**\nĐọc phòng Rules và các thông báo được ghim. Nếu muốn khiếu nại cảnh cáo, mute, kick hoặc ban, hãy gửi cho Moderator/Staff thời điểm xảy ra, lý do hiển thị và ngữ cảnh liên quan. Không đăng thông tin cá nhân của người khác.",
    en: "📜 **Rules / moderation action**\nReview the Rules channel and pinned announcements. To appeal a warning, mute, kick, or ban, contact a Moderator/Staff member with the time, displayed reason, and relevant context. Do not publish anyone's private information.",
    followVi: "Mày cần giải thích nội quy hay muốn khiếu nại một quyết định moderation?",
    followEn: "Do you need a rule explained, or are you appealing a moderation action?"
  },
  {
    key: "feedback", priority: 60,
    terms: ["gop y", "de xuat", "y tuong", "phan hoi", "feedback", "suggestion", "feature request", "kien nghi", "dong gop"],
    vi: "📮 **Góp ý cho POSTLAIN**\nVào phòng góp ý và dùng /feedback send để gửi đề xuất. Viết rõ vấn đề hiện tại, thay đổi mày muốn và lý do. Đừng gửi thông tin đăng nhập hoặc dữ liệu riêng tư.",
    en: "📮 **POSTLAIN feedback**\nUse /feedback send in the feedback channel. Explain the current problem, the change you would like, and why it would help. Do not include credentials or private information.",
    followVi: "Đây là góp ý tính năng, báo lỗi, hay đề xuất thay đổi nội quy/server?",
    followEn: "Is this a feature suggestion, a bug report, or feedback about server rules?"
  },
  {
    key: "events-community", priority: 55,
    terms: ["event", "su kien", "giveaway", "contest", "cuoc thi", "lich", "schedule", "tham gia", "join event", "meeting", "meetup", "hoat dong"],
    vi: "📅 **Sự kiện / hoạt động cộng đồng**\nKiểm tra phòng Events và thông báo được ghim để xem lịch, điều kiện tham gia và múi giờ. Nếu không thấy sự kiện hoặc nút đăng ký, gửi tên sự kiện và ảnh màn hình để Staff kiểm tra.",
    en: "📅 **Events / community activities**\nCheck the Events channel and pinned announcements for the schedule, eligibility, and timezone. If an event or registration button is missing, share the event name and a screenshot with Staff.",
    followVi: "Mày đang tìm lịch sự kiện, cách đăng ký hay gặp lỗi khi tham gia?",
    followEn: "Are you looking for the event schedule, registration steps, or troubleshooting participation?"
  },
  {
    key: "technical-issue", priority: 50,
    terms: ["loi", "error", "bug", "khong duoc", "khong hoat dong", "khong thay", "crash", "treo", "ket noi", "connection", "timeout", "failed", "failure", "not working", "doesnt work", "does not work", "broken", "loading forever", "khong tai duoc", "bi dung", "bi lag"],
    vi: "🧰 **Lỗi kỹ thuật**\nĐể xử lý nhanh, gửi 4 thứ: (1) mày đang làm gì, (2) mong đợi điều gì, (3) thực tế xảy ra gì, (4) ảnh hoặc nguyên văn lỗi. Nói thêm thiết bị và ứng dụng đang dùng. Nhớ che token, mật khẩu và mã xác thực.",
    en: "🧰 **Technical issue**\nPlease include: (1) what you were doing, (2) what you expected, (3) what actually happened, and (4) a screenshot or exact error text. Also mention your device and app. Hide tokens, passwords, and verification codes.",
    followVi: "Lỗi xảy ra khi mày thao tác gì, và đang dùng Android, iPhone hay máy tính?",
    followEn: "What action triggers the issue, and are you on Android, iPhone, or desktop?"
  }
];

function containsPhrase(text, phrase) {
  return (" " + text + " ").includes(" " + phrase + " ");
}

function hasVietnameseSignals(raw, normalized) {
  return /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởợúùủũụứừửữựýỳỷỹỵ]/i.test(raw)
    || ["minh", "ban", "khong", "duoc", "giup", "hoi", "o dau", "tai sao", "vi sao", "nhu the nao", "voi", "nhe"].some(x => containsPhrase(normalized, x));
}

export function classifySupportMessage(content) {
  const raw = String(content || "").trim();
  if (raw.length < 2 || raw.length > MAX_MESSAGE_LENGTH) return null;
  const text = normalizeSupportText(raw);
  if (!text) return null;

  const helpCue = HELP_CUES.some(x => containsPhrase(text, x));
  const ranked = CATEGORIES.map(category => {
    const hits = category.terms.filter(term => containsPhrase(text, term));
    return { category, hits, score: hits.length * 3 + (helpCue ? 2 : 0) };
  }).filter(item => item.hits.length > 0 && (
    helpCue ||
    item.category.priority >= 90 ||
    item.hits.some(term => !BROAD_TERMS.has(term))
  )).sort((a, b) => b.category.priority - a.category.priority || b.score - a.score);

  const standaloneHelp = /^(help|sos|cuu|support|ho tro|giup voi|help me|anyone know|co ai biet)$/.test(text);
  if (!ranked.length && !helpCue && !standaloneHelp) return null;

  const selected = ranked[0]?.category;
  const vietnamese = hasVietnameseSignals(raw, text);
  if (!selected) {
    return {
      key: "general-help",
      priority: 10,
      requiresStaff: false,
      response: vietnamese
        ? "🙋 **POSTLAIN Support đây!**\nMày đang cần giúp chuyện gì? Nói rõ vấn đề, phòng đang gặp lỗi và điều mày đã thử. Nếu có thông báo lỗi, gửi nguyên văn hoặc ảnh chụp (nhớ che thông tin riêng tư)."
        : "🙋 **POSTLAIN Support here!**\nWhat do you need help with? Describe the issue, which channel or feature is involved, and what you have tried. Share the exact error or a screenshot, with private details hidden.",
      followUp: vietnamese ? "Mày cần hỗ trợ về role, xác minh, Discord, âm thanh, nội quy hay vấn đề khác?" : "Is this about roles, verification, Discord, audio, rules, or something else?"
    };
  }

  return {
    key: selected.key,
    priority: selected.priority,
    requiresStaff: Boolean(selected.staff),
    response: vietnamese ? selected.vi : selected.en,
    followUp: vietnamese ? selected.followVi : selected.followEn
  };
}

export function isHelpRequest(content) {
  return Boolean(classifySupportMessage(content));
}

export function isProactiveCandidate(content) {
  return Boolean(classifySupportMessage(content));
}
