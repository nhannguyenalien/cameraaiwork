(() => {
  const translations = {
    vi: {
      dashboard: 'Mở dashboard', terms: 'Điều khoản dịch vụ', title: 'Chính sách quyền riêng tư', subtitle: 'Cập nhật lần cuối: 13/09/2026',
      nav: ['Giới thiệu','Dữ liệu thu thập','Cách chúng tôi sử dụng','Bên thứ ba & Google Drive','Dữ liệu sinh trắc học','Lưu trữ & Xoá','Quyền của bạn','Bảo mật','Trẻ em','Thay đổi chính sách','Liên hệ'],
      introTitle: 'Giới thiệu', introBody: 'CameraAIWork ("chúng tôi") cung cấp dịch vụ giám sát camera thông minh: nhận diện khuôn mặt, phát hiện chuyển động, cảnh báo tức thời, xem trực tiếp và trợ lý AI. Chính sách này giải thích dữ liệu nào chúng tôi thu thập khi bạn dùng dashboard, camera và các tích hợp liên quan (Google Drive, S3, Telegram...), vì sao chúng tôi thu thập, và các quyền bạn có đối với dữ liệu đó.',
      dataTitle: 'Dữ liệu chúng tôi thu thập', dataList: [
        '<strong>Thông tin tài khoản:</strong> email, mật khẩu (đã băm), thông tin thanh toán xử lý qua Stripe (chúng tôi không lưu số thẻ).',
        '<strong>Cấu hình site/camera:</strong> tên site, địa chỉ IP camera nội bộ, thông tin ONVIF/RTSP do bạn nhập.',
        '<strong>Ảnh và video sự kiện:</strong> ảnh chụp và clip ngắn khi camera phát hiện chuyển động/người, lưu tại nơi bạn chọn (Cloudflare R2, S3 riêng, hoặc Google Drive riêng của bạn).',
        '<strong>Dữ liệu sinh trắc học:</strong> embedding khuôn mặt dùng để nhận diện người quen (xem mục riêng bên dưới).',
        '<strong>Thông tin tích hợp bên thứ ba:</strong> Telegram bot token, RunPod API key, khoá S3, hoặc quyền truy cập Google Drive — được mã hoá trước khi lưu.',
        '<strong>Dữ liệu sử dụng:</strong> nhật ký truy cập API, thời điểm đăng nhập, thiết bị/trình duyệt, phục vụ vận hành và bảo mật.',
      ],
      useTitle: 'Cách chúng tôi sử dụng dữ liệu', useList: [
        'Vận hành dịch vụ: hiển thị live view, phát hiện chuyển động, gửi cảnh báo, trả lời câu hỏi qua AI Agent.',
        'Nhận diện và gom nhóm khuôn mặt để bạn biết ai xuất hiện trong sự kiện.',
        'Lưu trữ ảnh/video theo lựa chọn của bạn (R2 mặc định, hoặc S3/Google Drive riêng nếu bạn kết nối).',
        'Xử lý thanh toán và quản lý gói dịch vụ (Free/Pro) qua Stripe.',
        'Gỡ lỗi, đảm bảo an toàn hệ thống và cải thiện chất lượng dịch vụ.',
        'Chúng tôi không bán dữ liệu cá nhân hoặc hình ảnh/video của bạn cho bên thứ ba.',
      ],
      thirdPartiesTitle: 'Bên thứ ba & Google Drive',
      thirdPartiesBody: 'Chúng tôi dùng các nhà cung cấp hạ tầng sau để vận hành dịch vụ, mỗi bên chỉ nhận dữ liệu cần thiết cho vai trò của họ: Cloudflare (hosting, lưu trữ R2), Neon (cơ sở dữ liệu), Stripe (thanh toán), RunPod (xử lý AI theo yêu cầu), Telegram Bot API (gửi cảnh báo nếu bạn bật).',
      googleDriveNote: '<strong>Nếu bạn kết nối Google Drive:</strong> chúng tôi chỉ yêu cầu quyền <code>drive.file</code> — phạm vi hẹp nhất Google cung cấp. Sau khi bạn cấp quyền, ứng dụng chỉ có thể đọc/ghi vào <em>đúng thư mục bạn chọn</em> qua hộp thoại Google Picker, không thể xem, liệt kê hay chỉnh sửa bất kỳ file/thư mục nào khác trong Drive của bạn. Bạn có thể thu hồi quyền này bất cứ lúc nào tại <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>. Việc CameraAIWork sử dụng và chuyển thông tin nhận được từ Google API tuân thủ <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Chính sách dữ liệu người dùng của Dịch vụ API Google</a>, bao gồm các yêu cầu về Sử dụng hạn chế (Limited Use).',
      biometricTitle: 'Dữ liệu sinh trắc học (nhận diện khuôn mặt)',
      biometricBody: 'Khi camera phát hiện người, hệ thống có thể tạo ra một "embedding" khuôn mặt (một dãy số toán học đại diện cho đặc điểm khuôn mặt, không phải ảnh khuôn mặt) để gom các lượt xuất hiện của cùng một người vào một hồ sơ "Người" trong dashboard của bạn. Dữ liệu này chỉ dùng nội bộ cho tài khoản của bạn, không dùng để nhận diện chéo giữa các khách hàng khác nhau, và không chia sẻ cho bên thứ ba nào ngoài các nhà cung cấp hạ tầng nêu trên. Bạn có thể xoá một hồ sơ "Người" hoặc toàn bộ dữ liệu khuôn mặt bất cứ lúc nào trong dashboard; embedding liên quan sẽ bị xoá vĩnh viễn khỏi hệ thống.',
      retentionTitle: 'Lưu trữ & Xoá dữ liệu', retentionList: [
        'Tài khoản dùng gói miễn phí (R2): dung lượng giới hạn, sự kiện cũ nhất bị xoá tự động khi vượt hạn mức để nhường chỗ cho sự kiện mới.',
        'Tài khoản dùng S3/Google Drive riêng: bạn toàn quyền kiểm soát thời gian lưu trữ theo chính sách của dịch vụ đó.',
        'Xoá tài khoản sẽ xoá toàn bộ camera, site, sự kiện, hồ sơ người và cấu hình tích hợp liên quan trong hệ thống của chúng tôi.',
      ],
      rightsTitle: 'Quyền của bạn', rightsList: [
        'Xem, xuất hoặc xoá ảnh/video sự kiện và hồ sơ người trực tiếp trong dashboard.',
        'Thu hồi quyền truy cập Google Drive bất cứ lúc nào tại Google Account của bạn hoặc bằng cách "Kết nối lại" sang nơi lưu khác trong dashboard.',
        'Yêu cầu xuất hoặc xoá toàn bộ dữ liệu tài khoản bằng cách liên hệ chúng tôi (xem mục Liên hệ).',
        'Đóng tài khoản bất cứ lúc nào; dữ liệu sẽ được xoá theo mục Lưu trữ & Xoá ở trên.',
      ],
      securityTitle: 'Bảo mật', securityBody: 'Mọi kết nối tới dashboard và camera đều qua HTTPS/WSS. Khoá bí mật của các tích hợp bên thứ ba (Telegram, RunPod, S3, Google Drive) được mã hoá bằng AES-GCM trước khi lưu vào cơ sở dữ liệu — chúng tôi không lưu mật khẩu hay access token dạng văn bản thuần. Việc điều khiển camera qua tunnel đều được ký và xác thực; không mở port trực tiếp ra Internet.',
      childrenTitle: 'Trẻ em', childrenBody: 'Dịch vụ không dành cho trẻ em dưới 16 tuổi và chúng tôi không cố ý thu thập thông tin tài khoản từ trẻ em. Nếu camera của bạn ghi nhận hình ảnh trẻ em trong khuôn viên giám sát, bạn (chủ tài khoản) chịu trách nhiệm tuân thủ quy định pháp luật về bảo vệ dữ liệu trẻ em áp dụng tại khu vực của bạn.',
      changesTitle: 'Thay đổi chính sách', changesBody: 'Chúng tôi có thể cập nhật chính sách này theo thời gian. Ngày cập nhật gần nhất luôn hiển thị ở đầu trang. Thay đổi quan trọng sẽ được thông báo qua email hoặc trong dashboard.',
      contactTitle: 'Liên hệ', contactBody: 'Mọi câu hỏi về quyền riêng tư, vui lòng liên hệ <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    en: {
      dashboard: 'Open dashboard', terms: 'Terms of Service', title: 'Privacy Policy', subtitle: 'Last updated: September 13, 2026',
      nav: ['Introduction','Data we collect','How we use it','Third parties & Google Drive','Biometric data','Retention & deletion','Your rights','Security','Children','Changes to this policy','Contact'],
      introTitle: 'Introduction', introBody: 'CameraAIWork ("we") provides smart camera monitoring: face recognition, motion detection, instant alerts, live view and an AI assistant. This policy explains what data we collect when you use the dashboard, cameras and related integrations (Google Drive, S3, Telegram, etc.), why we collect it, and the rights you have over that data.',
      dataTitle: 'Data we collect', dataList: [
        '<strong>Account information:</strong> email, hashed password, billing details processed via Stripe (we never store card numbers).',
        '<strong>Site/camera configuration:</strong> site name, local camera IP address, ONVIF/RTSP details you enter.',
        '<strong>Event images and video:</strong> snapshots and short clips captured when a camera detects motion/a person, stored wherever you choose (Cloudflare R2, your own S3, or your own Google Drive).',
        '<strong>Biometric data:</strong> face embeddings used to recognize familiar people (see the dedicated section below).',
        '<strong>Third-party integration details:</strong> your Telegram bot token, RunPod API key, S3 keys, or Google Drive access — encrypted before storage.',
        '<strong>Usage data:</strong> API access logs, sign-in times, device/browser, used for operations and security.',
      ],
      useTitle: 'How we use your data', useList: [
        'Run the service: live view, motion detection, alerts, and answering questions through the AI Agent.',
        'Recognize and group faces so you know who appears in an event.',
        'Store images/clips wherever you chose (R2 by default, or your own S3/Google Drive if connected).',
        'Process payments and manage your plan (Free/Pro) via Stripe.',
        'Debug issues, keep the system secure, and improve the service.',
        'We never sell your personal data or your footage to third parties.',
      ],
      thirdPartiesTitle: 'Third parties & Google Drive',
      thirdPartiesBody: 'We rely on the following infrastructure providers to run the service, each receiving only what its role requires: Cloudflare (hosting, R2 storage), Neon (database), Stripe (billing), RunPod (on-demand AI processing), Telegram Bot API (alerts, if you enable them).',
      googleDriveNote: '<strong>If you connect Google Drive:</strong> we request only the <code>drive.file</code> scope — the narrowest Google offers. Once you grant access, the app can only read/write the <em>exact folder you pick</em> through the Google Picker dialog — it cannot see, list, or modify any other file or folder in your Drive. You can revoke this access at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>. CameraAIWork\'s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>, including the Limited Use requirements.',
      biometricTitle: 'Biometric data (face recognition)',
      biometricBody: 'When a camera detects a person, the system may generate a face "embedding" — a mathematical representation of facial features, not a photo — to group repeat appearances of the same person into a "Person" record in your dashboard. This data is used only within your own account, is never used to cross-match against other customers, and is never shared with any third party beyond the infrastructure providers listed above. You can delete any Person record, or all face data, at any time from the dashboard; the underlying embeddings are permanently removed.',
      retentionTitle: 'Retention & deletion', retentionList: [
        'Free-tier (R2) accounts: storage is capped and the oldest events are automatically deleted once the cap is reached, to make room for new ones.',
        'Accounts using your own S3/Google Drive: you fully control retention according to that service\'s own policies.',
        'Deleting your account deletes every camera, site, event, person record and integration configuration we hold for it.',
      ],
      rightsTitle: 'Your rights', rightsList: [
        'View, export, or delete event images/videos and person records directly in the dashboard.',
        'Revoke Google Drive access at any time from your Google Account, or by reconnecting to a different storage backend in the dashboard.',
        'Request export or deletion of your entire account\'s data by contacting us (see Contact).',
        'Close your account at any time; data is deleted per the Retention & deletion section above.',
      ],
      securityTitle: 'Security', securityBody: 'All connections to the dashboard and cameras use HTTPS/WSS. Secrets for third-party integrations (Telegram, RunPod, S3, Google Drive) are encrypted with AES-GCM before being stored — we never store passwords or access tokens in plain text. Camera control over the tunnel is signed and authenticated; no ports are opened directly to the Internet.',
      childrenTitle: 'Children', childrenBody: 'The service is not directed at children under 16, and we do not knowingly collect account information from children. If your cameras capture images of children within the monitored premises, you (the account holder) are responsible for complying with any child data-protection laws applicable in your region.',
      changesTitle: 'Changes to this policy', changesBody: 'We may update this policy from time to time. The most recent update date is always shown at the top of this page. Material changes will be announced by email or in the dashboard.',
      contactTitle: 'Contact', contactBody: 'For any privacy questions, contact <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    ja: {
      dashboard: 'ダッシュボード', terms: '利用規約', title: 'プライバシーポリシー', subtitle: '最終更新日: 2026年9月13日',
      nav: ['はじめに','収集するデータ','利用目的','第三者とGoogle Drive','生体データ','保存と削除','あなたの権利','セキュリティ','子どものプライバシー','ポリシーの変更','お問い合わせ'],
      introTitle: 'はじめに', introBody: 'CameraAIWork（以下「当社」）は、顔認識、動体検知、即時アラート、ライブ視聴、AIアシスタントを備えたスマートカメラ監視サービスを提供します。本ポリシーは、ダッシュボード・カメラ・関連連携（Google Drive、S3、Telegramなど）の利用時に当社が収集するデータ、その理由、およびお客様の権利について説明します。',
      dataTitle: '収集するデータ', dataList: [
        '<strong>アカウント情報：</strong>メールアドレス、ハッシュ化されたパスワード、Stripe経由の請求情報（カード番号は保存しません）。',
        '<strong>サイト/カメラ設定：</strong>サイト名、カメラのローカルIPアドレス、入力されたONVIF/RTSP情報。',
        '<strong>イベント画像・動画：</strong>カメラが動体・人物を検知した際のスナップショットと短いクリップ。保存先はお客様が選択（Cloudflare R2、独自S3、または独自Google Drive）。',
        '<strong>生体データ：</strong>顔の埋め込みベクトルによる既知の人物認識（詳細は下記参照）。',
        '<strong>第三者連携情報：</strong>Telegram botトークン、RunPod APIキー、S3キー、Google Driveアクセス権 — 保存前に暗号化。',
        '<strong>利用データ：</strong>APIアクセスログ、ログイン時刻、デバイス/ブラウザ情報（運用・セキュリティ目的）。',
      ],
      useTitle: 'データの利用方法', useList: [
        'サービスの提供：ライブ視聴、動体検知、アラート送信、AIエージェントによる質問応答。',
        '顔を認識・グループ化し、イベントに誰が写っているかを把握。',
        '選択した保存先に画像/クリップを保存（デフォルトはR2、接続時は独自S3/Google Drive）。',
        'Stripe経由での支払い処理とプラン（Free/Pro）管理。',
        '不具合の調査、システムの安全確保、サービス品質の改善。',
        '個人データや映像を第三者に販売することは一切ありません。',
      ],
      thirdPartiesTitle: '第三者とGoogle Drive',
      thirdPartiesBody: 'サービス運営のため、以下のインフラ事業者を利用しています。各社には役割に必要なデータのみを提供します：Cloudflare（ホスティング、R2ストレージ）、Neon（データベース）、Stripe（決済）、RunPod（オンデマンドAI処理）、Telegram Bot API（有効化した場合のアラート送信）。',
      googleDriveNote: '<strong>Google Driveを接続する場合：</strong>Googleが提供する中で最も狭い範囲である <code>drive.file</code> スコープのみを要求します。権限付与後、アプリはGoogle Pickerダイアログで<em>選択した正確なフォルダ</em>のみを読み書きでき、Drive内の他のファイルやフォルダを閲覧・一覧表示・変更することはできません。この権限はいつでも <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a> で取り消せます。CameraAIWorkによるGoogle API由来情報の利用・転送は、Limited Useの要件を含む<a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google APIサービスのユーザーデータポリシー</a>に準拠します。',
      biometricTitle: '生体データ（顔認識）',
      biometricBody: 'カメラが人物を検知すると、システムは顔の「埋め込みベクトル」（写真ではなく顔特徴を表す数値データ）を生成し、同一人物の再出現をダッシュボード内の「人物」レコードにまとめることがあります。このデータはお客様自身のアカウント内でのみ使用され、他の顧客とのクロスマッチには使用されず、上記のインフラ事業者以外の第三者と共有されることもありません。ダッシュボードからいつでも人物レコードや全ての顔データを削除でき、関連する埋め込みベクトルは完全に削除されます。',
      retentionTitle: '保存と削除', retentionList: [
        '無料プラン（R2）：容量に上限があり、上限に達すると最も古いイベントが自動的に削除され、新しいイベントのための空きが確保されます。',
        '独自S3/Google Driveを利用するアカウント：保存期間はそのサービス自体のポリシーに従い、お客様が完全に管理します。',
        'アカウントを削除すると、当社が保持する全てのカメラ、サイト、イベント、人物レコード、連携設定が削除されます。',
      ],
      rightsTitle: 'あなたの権利', rightsList: [
        'ダッシュボードから直接、イベント画像/動画や人物レコードを閲覧・エクスポート・削除できます。',
        'Googleアカウントからいつでも Google Drive のアクセス権を取り消すか、ダッシュボードで別の保存先に再接続できます。',
        'お問い合わせ（下記参照）により、アカウント全体のデータのエクスポートまたは削除を依頼できます。',
        'いつでもアカウントを閉鎖でき、データは上記「保存と削除」に従って削除されます。',
      ],
      securityTitle: 'セキュリティ', securityBody: 'ダッシュボードおよびカメラへの全ての接続はHTTPS/WSSを使用します。第三者連携（Telegram、RunPod、S3、Google Drive）のシークレットは保存前にAES-GCMで暗号化されます — パスワードやアクセストークンを平文で保存することはありません。トンネル経由のカメラ制御は署名・認証済みで、インターネットに直接ポートを開放することはありません。',
      childrenTitle: '子どものプライバシー', childrenBody: '本サービスは16歳未満の子どもを対象としておらず、子どものアカウント情報を意図的に収集することはありません。監視対象の敷地内でカメラが子どもの映像を記録する場合、お客様（アカウント所有者）が、お住まいの地域で適用される子どものデータ保護に関する法令を遵守する責任を負います。',
      changesTitle: 'ポリシーの変更', changesBody: '本ポリシーは随時更新されることがあります。最新の更新日は常にページ上部に表示されます。重要な変更はメールまたはダッシュボード内で通知します。',
      contactTitle: 'お問い合わせ', contactBody: 'プライバシーに関するご質問は <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a> までご連絡ください。',
    },
    fr: {
      dashboard: 'Ouvrir le tableau de bord', terms: 'Conditions d’utilisation', title: 'Politique de confidentialité', subtitle: 'Dernière mise à jour : 13 septembre 2026',
      nav: ['Introduction','Données collectées','Utilisation des données','Tiers & Google Drive','Données biométriques','Conservation & suppression','Vos droits','Sécurité','Enfants','Modifications de la politique','Contact'],
      introTitle: 'Introduction', introBody: 'CameraAIWork (« nous ») propose une surveillance intelligente par caméra : reconnaissance faciale, détection de mouvement, alertes instantanées, visionnage en direct et un assistant IA. Cette politique explique quelles données nous collectons lorsque vous utilisez le tableau de bord, les caméras et les intégrations associées (Google Drive, S3, Telegram, etc.), pourquoi nous les collectons, et les droits dont vous disposez sur ces données.',
      dataTitle: 'Données que nous collectons', dataList: [
        '<strong>Informations de compte :</strong> e-mail, mot de passe haché, informations de facturation traitées via Stripe (nous ne stockons jamais les numéros de carte).',
        '<strong>Configuration site/caméra :</strong> nom du site, adresse IP locale de la caméra, informations ONVIF/RTSP que vous saisissez.',
        '<strong>Images et vidéos d’événements :</strong> instantanés et courts clips capturés lorsqu’une caméra détecte un mouvement/une personne, stockés à l’endroit de votre choix (Cloudflare R2, votre propre S3, ou votre propre Google Drive).',
        '<strong>Données biométriques :</strong> empreintes faciales utilisées pour reconnaître les personnes familières (voir la section dédiée ci-dessous).',
        '<strong>Informations d’intégration tierce :</strong> jeton de bot Telegram, clé API RunPod, clés S3, ou accès Google Drive — chiffrés avant stockage.',
        '<strong>Données d’utilisation :</strong> journaux d’accès à l’API, heures de connexion, appareil/navigateur, utilisés pour l’exploitation et la sécurité.',
      ],
      useTitle: 'Comment nous utilisons vos données', useList: [
        'Faire fonctionner le service : visionnage en direct, détection de mouvement, alertes, et réponses aux questions via l’Agent IA.',
        'Reconnaître et regrouper les visages pour savoir qui apparaît dans un événement.',
        'Stocker les images/clips à l’endroit choisi (R2 par défaut, ou votre propre S3/Google Drive si connecté).',
        'Traiter les paiements et gérer votre forfait (Free/Pro) via Stripe.',
        'Déboguer les problèmes, assurer la sécurité du système et améliorer le service.',
        'Nous ne vendons jamais vos données personnelles ni vos enregistrements à des tiers.',
      ],
      thirdPartiesTitle: 'Tiers & Google Drive',
      thirdPartiesBody: 'Nous nous appuyons sur les fournisseurs d’infrastructure suivants pour faire fonctionner le service, chacun ne recevant que ce dont son rôle a besoin : Cloudflare (hébergement, stockage R2), Neon (base de données), Stripe (facturation), RunPod (traitement IA à la demande), Telegram Bot API (alertes, si activées).',
      googleDriveNote: '<strong>Si vous connectez Google Drive :</strong> nous ne demandons que le champ d’application <code>drive.file</code> — le plus restreint proposé par Google. Une fois l’accès accordé, l’application ne peut lire/écrire que dans <em>le dossier exact que vous choisissez</em> via la boîte de dialogue Google Picker — elle ne peut ni voir, ni lister, ni modifier aucun autre fichier ou dossier de votre Drive. Vous pouvez révoquer cet accès à tout moment sur <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>. L’utilisation et le transfert par CameraAIWork des informations reçues des API Google respectent la <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">politique des données utilisateur des services API Google</a>, y compris les exigences d’usage limité.',
      biometricTitle: 'Données biométriques (reconnaissance faciale)',
      biometricBody: 'Lorsqu’une caméra détecte une personne, le système peut générer une « empreinte » faciale — une représentation mathématique des traits du visage, pas une photo — afin de regrouper les apparitions répétées d’une même personne dans une fiche « Personne » de votre tableau de bord. Ces données ne sont utilisées qu’au sein de votre propre compte, ne servent jamais à un recoupement entre différents clients, et ne sont partagées avec aucun tiers autre que les fournisseurs d’infrastructure listés ci-dessus. Vous pouvez supprimer une fiche « Personne » ou toutes les données faciales à tout moment depuis le tableau de bord ; les empreintes correspondantes sont alors définitivement supprimées.',
      retentionTitle: 'Conservation & suppression', retentionList: [
        'Comptes en offre gratuite (R2) : le stockage est plafonné et les événements les plus anciens sont automatiquement supprimés une fois le plafond atteint, pour faire de la place aux nouveaux.',
        'Comptes utilisant votre propre S3/Google Drive : vous contrôlez entièrement la durée de conservation selon les règles propres à ce service.',
        'La suppression de votre compte entraîne la suppression de toutes les caméras, sites, événements, fiches personnes et configurations d’intégration que nous conservons.',
      ],
      rightsTitle: 'Vos droits', rightsList: [
        'Consulter, exporter ou supprimer les images/vidéos d’événements et les fiches personnes directement dans le tableau de bord.',
        'Révoquer l’accès à Google Drive à tout moment depuis votre compte Google, ou en reconnectant un autre service de stockage dans le tableau de bord.',
        'Demander l’export ou la suppression de toutes les données de votre compte en nous contactant (voir Contact).',
        'Fermer votre compte à tout moment ; les données sont supprimées conformément à la section Conservation & suppression ci-dessus.',
      ],
      securityTitle: 'Sécurité', securityBody: 'Toutes les connexions au tableau de bord et aux caméras utilisent HTTPS/WSS. Les secrets des intégrations tierces (Telegram, RunPod, S3, Google Drive) sont chiffrés en AES-GCM avant stockage — nous ne stockons jamais de mots de passe ou de jetons d’accès en clair. Le contrôle des caméras via le tunnel est signé et authentifié ; aucun port n’est ouvert directement sur Internet.',
      childrenTitle: 'Enfants', childrenBody: 'Le service ne s’adresse pas aux enfants de moins de 16 ans et nous ne collectons pas sciemment d’informations de compte auprès d’enfants. Si vos caméras captent des images d’enfants dans les lieux surveillés, vous (titulaire du compte) êtes responsable du respect des lois sur la protection des données des enfants applicables dans votre région.',
      changesTitle: 'Modifications de la politique', changesBody: 'Nous pouvons mettre à jour cette politique de temps à autre. La date de mise à jour la plus récente est toujours affichée en haut de cette page. Les changements importants seront annoncés par e-mail ou dans le tableau de bord.',
      contactTitle: 'Contact', contactBody: 'Pour toute question relative à la confidentialité, contactez <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    ko: {
      dashboard: '대시보드 열기', terms: '이용약관', title: '개인정보 처리방침', subtitle: '최종 업데이트: 2026년 9월 13일',
      nav: ['소개','수집하는 데이터','이용 방법','제3자 및 Google Drive','생체 데이터','보관 및 삭제','귀하의 권리','보안','아동','정책 변경','문의'],
      introTitle: '소개', introBody: 'CameraAIWork("당사")는 얼굴 인식, 동작 감지, 즉시 알림, 실시간 보기, AI 어시스턴트를 갖춘 스마트 카메라 모니터링 서비스를 제공합니다. 본 방침은 대시보드, 카메라 및 관련 연동(Google Drive, S3, Telegram 등) 이용 시 당사가 수집하는 데이터, 수집 이유, 그리고 귀하가 해당 데이터에 대해 가지는 권리를 설명합니다.',
      dataTitle: '수집하는 데이터', dataList: [
        '<strong>계정 정보:</strong> 이메일, 해시된 비밀번호, Stripe를 통해 처리되는 결제 정보(카드 번호는 저장하지 않음).',
        '<strong>사이트/카메라 설정:</strong> 사이트 이름, 카메라의 로컬 IP 주소, 입력한 ONVIF/RTSP 정보.',
        '<strong>이벤트 이미지 및 동영상:</strong> 카메라가 동작/사람을 감지했을 때의 스냅샷과 짧은 클립. 저장 위치는 귀하가 선택(Cloudflare R2, 자체 S3, 또는 자체 Google Drive).',
        '<strong>생체 데이터:</strong> 아는 사람을 인식하기 위한 얼굴 임베딩(아래 별도 섹션 참조).',
        '<strong>제3자 연동 정보:</strong> Telegram 봇 토큰, RunPod API 키, S3 키, Google Drive 액세스 권한 — 저장 전 암호화됨.',
        '<strong>이용 데이터:</strong> API 접근 로그, 로그인 시각, 기기/브라우저 정보(운영 및 보안 목적).',
      ],
      useTitle: '데이터 이용 방법', useList: [
        '서비스 제공: 실시간 보기, 동작 감지, 알림 전송, AI 에이전트를 통한 질의응답.',
        '얼굴을 인식하고 그룹화하여 이벤트에 누가 등장했는지 파악.',
        '선택한 위치에 이미지/클립 저장(기본값 R2, 연결 시 자체 S3/Google Drive).',
        'Stripe를 통한 결제 처리 및 요금제(Free/Pro) 관리.',
        '문제 디버깅, 시스템 보안 유지, 서비스 품질 개선.',
        '개인 데이터나 영상을 제3자에게 판매하지 않습니다.',
      ],
      thirdPartiesTitle: '제3자 및 Google Drive',
      thirdPartiesBody: '서비스 운영을 위해 다음 인프라 제공업체를 이용하며, 각 업체는 역할에 필요한 데이터만 받습니다: Cloudflare(호스팅, R2 저장소), Neon(데이터베이스), Stripe(결제), RunPod(온디맨드 AI 처리), Telegram Bot API(활성화 시 알림 전송).',
      googleDriveNote: '<strong>Google Drive를 연결하는 경우:</strong> Google이 제공하는 범위 중 가장 좁은 <code>drive.file</code> 범위만 요청합니다. 권한을 부여하면 앱은 Google Picker 대화상자에서 <em>선택한 정확한 폴더</em>만 읽고 쓸 수 있으며, Drive 내 다른 파일이나 폴더는 보거나 나열하거나 수정할 수 없습니다. 이 권한은 언제든지 <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>에서 취소할 수 있습니다. CameraAIWork가 Google API로부터 수신한 정보를 사용 및 전송하는 방식은 제한된 사용(Limited Use) 요건을 포함한 <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API 서비스 사용자 데이터 정책</a>을 준수합니다.',
      biometricTitle: '생체 데이터(얼굴 인식)',
      biometricBody: '카메라가 사람을 감지하면 시스템은 사진이 아닌 얼굴 특징을 수학적으로 표현한 얼굴 "임베딩"을 생성하여, 동일 인물의 반복 등장을 대시보드의 "인물" 레코드로 그룹화할 수 있습니다. 이 데이터는 귀하의 계정 내에서만 사용되며, 다른 고객 간 교차 매칭에는 사용되지 않고, 위에 명시된 인프라 제공업체 외 어떤 제3자와도 공유되지 않습니다. 대시보드에서 언제든지 인물 레코드 또는 모든 얼굴 데이터를 삭제할 수 있으며, 관련 임베딩은 영구적으로 제거됩니다.',
      retentionTitle: '보관 및 삭제', retentionList: [
        '무료 요금제(R2) 계정: 저장 용량에 한도가 있으며, 한도에 도달하면 새 이벤트를 위해 가장 오래된 이벤트가 자동으로 삭제됩니다.',
        '자체 S3/Google Drive를 사용하는 계정: 해당 서비스 자체 정책에 따라 보관 기간을 전적으로 귀하가 관리합니다.',
        '계정을 삭제하면 당사가 보유한 모든 카메라, 사이트, 이벤트, 인물 레코드 및 연동 설정이 삭제됩니다.',
      ],
      rightsTitle: '귀하의 권리', rightsList: [
        '대시보드에서 직접 이벤트 이미지/동영상 및 인물 레코드를 조회, 내보내기 또는 삭제.',
        'Google 계정에서 언제든지 Google Drive 액세스 권한을 취소하거나, 대시보드에서 다른 저장소로 재연결.',
        '문의(연락처 참조)를 통해 전체 계정 데이터의 내보내기 또는 삭제 요청.',
        '언제든지 계정을 해지할 수 있으며, 데이터는 위 보관 및 삭제 섹션에 따라 삭제됩니다.',
      ],
      securityTitle: '보안', securityBody: '대시보드 및 카메라에 대한 모든 연결은 HTTPS/WSS를 사용합니다. 제3자 연동(Telegram, RunPod, S3, Google Drive)의 비밀 정보는 저장 전 AES-GCM으로 암호화됩니다 — 비밀번호나 액세스 토큰을 평문으로 저장하지 않습니다. 터널을 통한 카메라 제어는 서명 및 인증되며, 인터넷에 포트를 직접 개방하지 않습니다.',
      childrenTitle: '아동', childrenBody: '본 서비스는 16세 미만 아동을 대상으로 하지 않으며, 아동으로부터 계정 정보를 의도적으로 수집하지 않습니다. 카메라가 감시 구역 내 아동의 영상을 촬영하는 경우, 계정 소유자인 귀하가 해당 지역에 적용되는 아동 데이터 보호법을 준수할 책임이 있습니다.',
      changesTitle: '정책 변경', changesBody: '본 방침은 수시로 업데이트될 수 있습니다. 최신 업데이트 날짜는 항상 이 페이지 상단에 표시됩니다. 중요한 변경 사항은 이메일 또는 대시보드를 통해 공지됩니다.',
      contactTitle: '문의', contactBody: '개인정보 관련 문의는 <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>으로 연락해 주세요.',
    },
    es: {
      dashboard: 'Abrir panel', terms: 'Términos del servicio', title: 'Política de privacidad', subtitle: 'Última actualización: 13 de septiembre de 2026',
      nav: ['Introducción','Datos que recopilamos','Cómo los usamos','Terceros y Google Drive','Datos biométricos','Conservación y eliminación','Tus derechos','Seguridad','Menores','Cambios a esta política','Contacto'],
      introTitle: 'Introducción', introBody: 'CameraAIWork ("nosotros") ofrece monitoreo inteligente por cámara: reconocimiento facial, detección de movimiento, alertas instantáneas, visualización en vivo y un asistente de IA. Esta política explica qué datos recopilamos cuando usas el panel, las cámaras y las integraciones relacionadas (Google Drive, S3, Telegram, etc.), por qué los recopilamos y los derechos que tienes sobre ellos.',
      dataTitle: 'Datos que recopilamos', dataList: [
        '<strong>Información de cuenta:</strong> correo electrónico, contraseña con hash, datos de facturación procesados vía Stripe (nunca almacenamos números de tarjeta).',
        '<strong>Configuración de sitio/cámara:</strong> nombre del sitio, dirección IP local de la cámara, datos ONVIF/RTSP que introduces.',
        '<strong>Imágenes y video de eventos:</strong> capturas y clips breves cuando una cámara detecta movimiento/una persona, guardados donde elijas (Cloudflare R2, tu propio S3, o tu propio Google Drive).',
        '<strong>Datos biométricos:</strong> embeddings faciales usados para reconocer personas conocidas (ver la sección dedicada más abajo).',
        '<strong>Datos de integraciones de terceros:</strong> token de bot de Telegram, clave API de RunPod, claves de S3, o acceso a Google Drive — cifrados antes de almacenarse.',
        '<strong>Datos de uso:</strong> registros de acceso a la API, horas de inicio de sesión, dispositivo/navegador, usados para operación y seguridad.',
      ],
      useTitle: 'Cómo usamos tus datos', useList: [
        'Operar el servicio: visualización en vivo, detección de movimiento, alertas y respuestas a través del Agente de IA.',
        'Reconocer y agrupar rostros para que sepas quién aparece en un evento.',
        'Guardar imágenes/clips donde elijas (R2 por defecto, o tu propio S3/Google Drive si lo conectas).',
        'Procesar pagos y gestionar tu plan (Free/Pro) vía Stripe.',
        'Depurar problemas, mantener la seguridad del sistema y mejorar el servicio.',
        'Nunca vendemos tus datos personales ni tus grabaciones a terceros.',
      ],
      thirdPartiesTitle: 'Terceros y Google Drive',
      thirdPartiesBody: 'Dependemos de los siguientes proveedores de infraestructura para operar el servicio, cada uno recibe solo lo necesario para su función: Cloudflare (hosting, almacenamiento R2), Neon (base de datos), Stripe (facturación), RunPod (procesamiento de IA bajo demanda), Telegram Bot API (alertas, si las activas).',
      googleDriveNote: '<strong>Si conectas Google Drive:</strong> solo solicitamos el alcance <code>drive.file</code>, el más restringido que ofrece Google. Una vez concedido el acceso, la aplicación solo puede leer/escribir en <em>la carpeta exacta que elijas</em> mediante el cuadro de diálogo de Google Picker; no puede ver, listar ni modificar ningún otro archivo o carpeta de tu Drive. Puedes revocar este acceso en cualquier momento en <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a>. El uso y la transferencia por parte de CameraAIWork de la información recibida de las API de Google cumplen con la <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Política de datos de usuario de los servicios de API de Google</a>, incluidos los requisitos de Uso Limitado.',
      biometricTitle: 'Datos biométricos (reconocimiento facial)',
      biometricBody: 'Cuando una cámara detecta a una persona, el sistema puede generar un "embedding" facial —una representación matemática de los rasgos faciales, no una foto— para agrupar las apariciones repetidas de la misma persona en un registro de "Persona" en tu panel. Estos datos se usan únicamente dentro de tu propia cuenta, nunca se usan para cotejar entre distintos clientes y nunca se comparten con terceros más allá de los proveedores de infraestructura mencionados. Puedes eliminar cualquier registro de Persona, o todos los datos faciales, en cualquier momento desde el panel; los embeddings correspondientes se eliminan de forma permanente.',
      retentionTitle: 'Conservación y eliminación', retentionList: [
        'Cuentas de nivel gratuito (R2): el almacenamiento tiene un límite y los eventos más antiguos se eliminan automáticamente al alcanzarlo, para dejar espacio a los nuevos.',
        'Cuentas que usan tu propio S3/Google Drive: tú controlas por completo la retención según las políticas de ese servicio.',
        'Eliminar tu cuenta elimina todas las cámaras, sitios, eventos, registros de personas y configuraciones de integración que conservamos.',
      ],
      rightsTitle: 'Tus derechos', rightsList: [
        'Ver, exportar o eliminar imágenes/videos de eventos y registros de personas directamente en el panel.',
        'Revocar el acceso a Google Drive en cualquier momento desde tu cuenta de Google, o reconectando a otro almacenamiento en el panel.',
        'Solicitar la exportación o eliminación de todos los datos de tu cuenta contactándonos (ver Contacto).',
        'Cerrar tu cuenta en cualquier momento; los datos se eliminan según la sección de Conservación y eliminación anterior.',
      ],
      securityTitle: 'Seguridad', securityBody: 'Todas las conexiones al panel y a las cámaras usan HTTPS/WSS. Los secretos de integraciones de terceros (Telegram, RunPod, S3, Google Drive) se cifran con AES-GCM antes de almacenarse; nunca guardamos contraseñas ni tokens de acceso en texto plano. El control de cámaras a través del túnel está firmado y autenticado; no se abren puertos directamente a Internet.',
      childrenTitle: 'Menores', childrenBody: 'El servicio no está dirigido a menores de 16 años y no recopilamos intencionadamente información de cuenta de menores. Si tus cámaras captan imágenes de menores dentro del área monitoreada, tú (el titular de la cuenta) eres responsable de cumplir con las leyes de protección de datos infantiles aplicables en tu región.',
      changesTitle: 'Cambios a esta política', changesBody: 'Podemos actualizar esta política periódicamente. La fecha de la actualización más reciente siempre se muestra en la parte superior de esta página. Los cambios importantes se anunciarán por correo electrónico o en el panel.',
      contactTitle: 'Contacto', contactBody: 'Para cualquier pregunta sobre privacidad, contacta a <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
  };

  const navIds = ['nav-intro','nav-data','nav-use','nav-third-parties','nav-biometric','nav-retention','nav-rights','nav-security','nav-children','nav-changes','nav-contact'];
  const set = (id, value, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = value; };
  const setList = (id, items) => set(id, items.map((x) => `<li>${x}</li>`).join(''), true);

  function applyLanguage(language) {
    const lang = translations[language] ? language : 'en';
    const t = translations[lang];
    document.documentElement.lang = lang;
    document.title = `${t.title} | CameraAIWork`;
    set('dashboard-link', t.dashboard);
    set('terms-link', t.terms);
    set('page-title', t.title);
    set('page-subtitle', t.subtitle);
    navIds.forEach((id, i) => set(id, t.nav[i]));
    set('intro-title', t.introTitle); set('intro-body', t.introBody);
    set('data-title', t.dataTitle); setList('data-list', t.dataList);
    set('use-title', t.useTitle); setList('use-list', t.useList);
    set('third-parties-title', t.thirdPartiesTitle); set('third-parties-body', t.thirdPartiesBody); set('google-drive-note', t.googleDriveNote, true);
    set('biometric-title', t.biometricTitle); set('biometric-body', t.biometricBody);
    set('retention-title', t.retentionTitle); setList('retention-list', t.retentionList);
    set('rights-title', t.rightsTitle); setList('rights-list', t.rightsList);
    set('security-title', t.securityTitle); set('security-body', t.securityBody);
    set('children-title', t.childrenTitle); set('children-body', t.childrenBody);
    set('changes-title', t.changesTitle); set('changes-body', t.changesBody);
    set('contact-title', t.contactTitle); set('contact-body', t.contactBody, true);
    document.getElementById('language-select').value = lang;
    localStorage.setItem('cameraaiwork_legal_language', lang);
    const url = new URL(location.href);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);
  }

  const browserLanguage = navigator.language.toLowerCase().split('-')[0];
  const initial = new URLSearchParams(location.search).get('lang') || localStorage.getItem('cameraaiwork_legal_language') || browserLanguage;
  document.getElementById('language-select').addEventListener('change', (event) => applyLanguage(event.target.value));
  applyLanguage(initial);
})();
