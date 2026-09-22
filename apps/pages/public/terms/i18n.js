(() => {
  const translations = {
    vi: {
      dashboard: 'Mở dashboard', privacy: 'Chính sách quyền riêng tư', title: 'Điều khoản dịch vụ', subtitle: 'Cập nhật lần cuối: 13/09/2026',
      nav: ['Chấp nhận điều khoản','Mô tả dịch vụ','Tài khoản & Trách nhiệm','Sử dụng hợp pháp','Gói dịch vụ & Thanh toán','Dữ liệu & Quyền sở hữu','Dịch vụ bên thứ ba','Chấm dứt','Miễn trừ bảo đảm','Giới hạn trách nhiệm','Luật áp dụng','Thay đổi điều khoản','Liên hệ'],
      acceptTitle: 'Chấp nhận điều khoản', acceptBody: 'Bằng việc tạo tài khoản hoặc sử dụng CameraAIWork ("Dịch vụ"), bạn đồng ý với các Điều khoản dịch vụ này và <a href="/privacy/">Chính sách quyền riêng tư</a> đi kèm. Nếu bạn không đồng ý, vui lòng ngừng sử dụng Dịch vụ.',
      serviceTitle: 'Mô tả dịch vụ', serviceBody: 'CameraAIWork là nền tảng SaaS kết nối camera IP tại chỗ với dashboard đám mây để cung cấp: xem trực tiếp, điều khiển PTZ, phát hiện chuyển động/người, nhận diện khuôn mặt, lưu trữ ảnh/video sự kiện, cảnh báo Telegram và trợ lý AI. Một số tính năng phụ thuộc gói dịch vụ (Free/Pro) hoặc yêu cầu bạn tự kết nối dịch vụ bên thứ ba (Google Drive, S3, Telegram, RunPod).',
      accountTitle: 'Tài khoản & Trách nhiệm', accountList: [
        'Bạn chịu trách nhiệm bảo mật mật khẩu và API key của tài khoản mình.',
        'Bạn chịu trách nhiệm về tính chính xác của thông tin camera/site bạn khai báo và phần cứng bạn kết nối.',
        'Bạn phải thông báo cho chúng tôi ngay nếu nghi ngờ tài khoản bị truy cập trái phép.',
      ],
      lawfulTitle: 'Sử dụng hợp pháp (giám sát camera)', lawfulAlert: 'Bạn cam kết chỉ lắp đặt và sử dụng camera tại địa điểm mà bạn có quyền hợp pháp để giám sát, và tuân thủ mọi quy định pháp luật hiện hành về giám sát, quyền riêng tư và bảo vệ dữ liệu tại khu vực đó (bao gồm nghĩa vụ thông báo cho người bị ghi hình nếu luật yêu cầu). CameraAIWork không chịu trách nhiệm về việc bạn sử dụng Dịch vụ để giám sát trái phép người khác, ghi âm/ghi hình không có sự đồng ý khi pháp luật yêu cầu, hoặc vi phạm quyền riêng tư của bên thứ ba.',
      billingTitle: 'Gói dịch vụ & Thanh toán', billingList: [
        'Gói Free có giới hạn về số site/camera, số người xem đồng thời và dung lượng lưu trữ R2.',
        'Gói Pro được thanh toán định kỳ qua Stripe; giá và giới hạn cụ thể hiển thị trong dashboard tại thời điểm đăng ký.',
        'Bạn có thể huỷ gói Pro bất cứ lúc nào; dịch vụ tiếp tục đến hết chu kỳ thanh toán đã trả, sau đó chuyển về gói Free.',
        'Chúng tôi có thể thay đổi giá cho chu kỳ thanh toán tiếp theo, có thông báo trước.',
      ],
      dataTitle: 'Dữ liệu & Quyền sở hữu', dataBody: 'Bạn sở hữu toàn bộ hình ảnh, video và dữ liệu camera do bạn tạo ra. Chúng tôi chỉ xử lý dữ liệu đó để cung cấp Dịch vụ như mô tả trong <a href="/privacy/">Chính sách quyền riêng tư</a>, và không sử dụng cho mục đích khác ngoài vận hành, bảo mật và cải thiện Dịch vụ. Nếu bạn kết nối lưu trữ riêng (S3/Google Drive), dữ liệu nằm trong tài khoản của bạn tại dịch vụ đó và tuân theo điều khoản của chính dịch vụ đó.',
      thirdPartiesTitle: 'Dịch vụ bên thứ ba', thirdPartiesBody: 'Dịch vụ có thể tích hợp với Google Drive, S3 tương thích, Telegram và RunPod theo lựa chọn của bạn. Mỗi dịch vụ này có điều khoản và mức độ khả dụng riêng, ngoài tầm kiểm soát của chúng tôi. Chúng tôi không chịu trách nhiệm về sự cố, gián đoạn hoặc mất dữ liệu xảy ra phía các dịch vụ bên thứ ba đó.',
      terminationTitle: 'Chấm dứt', terminationBody: 'Bạn có thể đóng tài khoản bất cứ lúc nào trong dashboard. Chúng tôi có thể tạm ngưng hoặc chấm dứt tài khoản vi phạm các Điều khoản này, đặc biệt là mục Sử dụng hợp pháp ở trên, có hoặc không thông báo trước tuỳ mức độ vi phạm. Sau khi chấm dứt, dữ liệu được xử lý theo mục Lưu trữ & Xoá trong Chính sách quyền riêng tư.',
      disclaimerTitle: 'Miễn trừ bảo đảm', disclaimerBody: 'Dịch vụ được cung cấp "nguyên trạng" ("as is"), không có bảo đảm dưới bất kỳ hình thức nào, kể cả bảo đảm về tính khả dụng liên tục, độ chính xác của nhận diện AI, hoặc tính phù hợp cho một mục đích cụ thể. CameraAIWork là công cụ hỗ trợ giám sát, không thay thế hệ thống an ninh chuyên dụng cho các tình huống có rủi ro cao đến tính mạng hoặc tài sản.',
      liabilityTitle: 'Giới hạn trách nhiệm', liabilityBody: 'Trong phạm vi tối đa pháp luật cho phép, CameraAIWork không chịu trách nhiệm cho các thiệt hại gián tiếp, ngẫu nhiên hoặc hệ quả phát sinh từ việc sử dụng hoặc không thể sử dụng Dịch vụ, bao gồm nhưng không giới hạn ở mất dữ liệu, gián đoạn kinh doanh, hoặc thiệt hại do bỏ lỡ sự kiện an ninh mà hệ thống không phát hiện được.',
      lawTitle: 'Luật áp dụng', lawBody: 'Các Điều khoản này được điều chỉnh bởi pháp luật Việt Nam, trừ khi có thoả thuận khác bằng văn bản giữa hai bên.',
      changesTitle: 'Thay đổi điều khoản', changesBody: 'Chúng tôi có thể cập nhật các Điều khoản này theo thời gian. Ngày cập nhật gần nhất luôn hiển thị ở đầu trang. Việc tiếp tục sử dụng Dịch vụ sau khi thay đổi có hiệu lực đồng nghĩa bạn chấp nhận các thay đổi đó.',
      contactTitle: 'Liên hệ', contactBody: 'Mọi câu hỏi về Điều khoản dịch vụ, vui lòng liên hệ <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    en: {
      dashboard: 'Open dashboard', privacy: 'Privacy Policy', title: 'Terms of Service', subtitle: 'Last updated: September 13, 2026',
      nav: ['Acceptance of terms','Description of service','Account & responsibilities','Lawful use','Plans & billing','Data & ownership','Third-party services','Termination','Disclaimer of warranties','Limitation of liability','Governing law','Changes to these terms','Contact'],
      acceptTitle: 'Acceptance of terms', acceptBody: 'By creating an account or using CameraAIWork (the "Service"), you agree to these Terms of Service and the accompanying <a href="/privacy/">Privacy Policy</a>. If you do not agree, please stop using the Service.',
      serviceTitle: 'Description of service', serviceBody: 'CameraAIWork is a SaaS platform that connects on-site IP cameras to a cloud dashboard to provide: live viewing, PTZ control, motion/person detection, face recognition, event image/video storage, Telegram alerts, and an AI assistant. Some features depend on your plan (Free/Pro) or require you to connect your own third-party services (Google Drive, S3, Telegram, RunPod).',
      accountTitle: 'Account & responsibilities', accountList: [
        'You are responsible for keeping your password and API keys secure.',
        'You are responsible for the accuracy of the camera/site information you provide and the hardware you connect.',
        'You must notify us promptly if you suspect unauthorized access to your account.',
      ],
      lawfulTitle: 'Lawful use (camera surveillance)', lawfulAlert: 'You agree to install and use cameras only at locations you have a legal right to monitor, and to comply with all applicable surveillance, privacy and data-protection laws in that jurisdiction (including any duty to notify people being recorded, where required by law). CameraAIWork is not responsible for your use of the Service to unlawfully monitor others, record without required consent, or otherwise violate a third party\'s privacy rights.',
      billingTitle: 'Plans & billing', billingList: [
        'The Free plan has limits on the number of sites/cameras, concurrent viewers, and R2 storage capacity.',
        'The Pro plan is billed on a recurring basis via Stripe; current pricing and limits are shown in the dashboard at signup.',
        'You may cancel Pro at any time; service continues until the end of the paid period, then reverts to Free.',
        'We may change pricing for future billing cycles, with advance notice.',
      ],
      dataTitle: 'Data & ownership', dataBody: 'You own all images, video, and camera data you generate. We only process that data to provide the Service as described in the <a href="/privacy/">Privacy Policy</a>, and never use it for any purpose beyond operating, securing, and improving the Service. If you connect your own storage (S3/Google Drive), that data lives in your own account with that provider and is subject to its own terms.',
      thirdPartiesTitle: 'Third-party services', thirdPartiesBody: 'The Service can integrate with Google Drive, S3-compatible storage, Telegram, and RunPod at your choice. Each of these has its own terms and availability, outside our control. We are not responsible for outages, disruptions, or data loss occurring on the side of those third-party services.',
      terminationTitle: 'Termination', terminationBody: 'You may close your account at any time from the dashboard. We may suspend or terminate an account that violates these Terms, particularly the Lawful use section above, with or without prior notice depending on severity. After termination, data is handled per the Retention & deletion section of the Privacy Policy.',
      disclaimerTitle: 'Disclaimer of warranties', disclaimerBody: 'The Service is provided "as is," without warranties of any kind, including warranties of continuous availability, AI detection accuracy, or fitness for a particular purpose. CameraAIWork is a monitoring aid, not a substitute for dedicated security systems in situations posing a high risk to life or property.',
      liabilityTitle: 'Limitation of liability', liabilityBody: 'To the maximum extent permitted by law, CameraAIWork is not liable for indirect, incidental, or consequential damages arising from use or inability to use the Service, including but not limited to data loss, business interruption, or harm from a security event the system failed to detect.',
      lawTitle: 'Governing law', lawBody: 'These Terms are governed by the laws of Vietnam, unless otherwise agreed in writing between the parties.',
      changesTitle: 'Changes to these terms', changesBody: 'We may update these Terms from time to time. The most recent update date is always shown at the top of this page. Continuing to use the Service after changes take effect means you accept them.',
      contactTitle: 'Contact', contactBody: 'For any questions about these Terms, contact <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    ja: {
      dashboard: 'ダッシュボード', privacy: 'プライバシーポリシー', title: '利用規約', subtitle: '最終更新日: 2026年9月13日',
      nav: ['規約への同意','サービスの説明','アカウントと責任','適法な利用','プランと支払い','データと所有権','第三者サービス','解約','保証の否認','責任の制限','準拠法','規約の変更','お問い合わせ'],
      acceptTitle: '規約への同意', acceptBody: 'アカウントを作成またはCameraAIWork（「本サービス」）を利用することにより、本利用規約および付属の<a href="/privacy/">プライバシーポリシー</a>に同意したものとみなされます。同意しない場合は、本サービスの利用を中止してください。',
      serviceTitle: 'サービスの説明', serviceBody: 'CameraAIWorkは、現地のIPカメラをクラウドダッシュボードに接続し、ライブ視聴、PTZ操作、動体/人物検知、顔認識、イベント画像/動画の保存、Telegramアラート、AIアシスタントを提供するSaaSプラットフォームです。一部の機能はプラン（Free/Pro）に依存するか、お客様自身による第三者サービス（Google Drive、S3、Telegram、RunPod）の接続が必要です。',
      accountTitle: 'アカウントと責任', accountList: [
        'パスワードおよびAPIキーの安全管理はお客様の責任です。',
        '登録するカメラ/サイト情報の正確性、および接続する機器についてお客様が責任を負います。',
        '不正アクセスの疑いがある場合は速やかに当社へご連絡ください。',
      ],
      lawfulTitle: '適法な利用（カメラ監視）', lawfulAlert: 'お客様は、法的に監視する権限を有する場所にのみカメラを設置・使用し、当該地域で適用される監視・プライバシー・データ保護に関する法令（法律で求められる場合の被撮影者への通知義務を含む）を遵守することに同意するものとします。CameraAIWorkは、お客様が本サービスを利用して他者を違法に監視すること、法律上必要な同意なく録音・録画すること、または第三者のプライバシー権を侵害することについて責任を負いません。',
      billingTitle: 'プランと支払い', billingList: [
        'Freeプランはサイト/カメラ数、同時視聴者数、R2ストレージ容量に上限があります。',
        'Proプランは Stripe 経由で定期的に請求されます。現在の料金と上限は登録時にダッシュボードに表示されます。',
        'Proはいつでも解約可能で、支払い済み期間の終了までサービスが継続し、その後Freeに戻ります。',
        '今後の請求サイクルの料金は事前通知の上で変更する場合があります。',
      ],
      dataTitle: 'データと所有権', dataBody: 'お客様が生成した画像・動画・カメラデータの全ての所有権はお客様に帰属します。当社は<a href="/privacy/">プライバシーポリシー</a>に記載の通り、サービス提供のためにのみそのデータを処理し、運用・セキュリティ・改善以外の目的で使用することはありません。独自のストレージ（S3/Google Drive）を接続した場合、そのデータは当該プロバイダーのお客様自身のアカウント内にあり、そのプロバイダー自身の規約に従います。',
      thirdPartiesTitle: '第三者サービス', thirdPartiesBody: '本サービスは、お客様の選択によりGoogle Drive、S3互換ストレージ、Telegram、RunPodと連携できます。これらはそれぞれ独自の規約と可用性を持ち、当社の管理範囲外です。これら第三者サービス側で発生した障害、中断、データ損失について当社は責任を負いません。',
      terminationTitle: '解約', terminationBody: 'ダッシュボードからいつでもアカウントを閉鎖できます。本規約、特に上記の適法な利用に違反するアカウントは、違反の程度に応じて事前通知の有無にかかわらず、当社が停止または解約する場合があります。解約後のデータはプライバシーポリシーの「保存と削除」に従って処理されます。',
      disclaimerTitle: '保証の否認', disclaimerBody: '本サービスは「現状有姿」で提供され、継続的な可用性、AI検知の精度、特定目的への適合性を含め、いかなる保証もありません。CameraAIWorkは監視を補助するツールであり、生命または財産に高いリスクを及ぼす状況における専用セキュリティシステムの代替ではありません。',
      liabilityTitle: '責任の制限', liabilityBody: '法律で許容される最大限の範囲において、CameraAIWorkは、データ損失、事業中断、システムが検知できなかったセキュリティ事案による損害を含め、本サービスの利用または利用不能から生じる間接的、付随的、または結果的損害について責任を負いません。',
      lawTitle: '準拠法', lawBody: '本規約は、両当事者間で別途書面による合意がない限り、ベトナム法に準拠します。',
      changesTitle: '規約の変更', changesBody: '本規約は随時更新されることがあります。最新の更新日は常にページ上部に表示されます。変更発効後も本サービスの利用を継続した場合、変更に同意したものとみなされます。',
      contactTitle: 'お問い合わせ', contactBody: '本規約に関するご質問は <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a> までご連絡ください。',
    },
    fr: {
      dashboard: 'Ouvrir le tableau de bord', privacy: 'Politique de confidentialité', title: 'Conditions d’utilisation', subtitle: 'Dernière mise à jour : 13 septembre 2026',
      nav: ['Acceptation des conditions','Description du service','Compte & responsabilités','Utilisation licite','Forfaits & facturation','Données & propriété','Services tiers','Résiliation','Exclusion de garantie','Limitation de responsabilité','Droit applicable','Modifications des conditions','Contact'],
      acceptTitle: 'Acceptation des conditions', acceptBody: 'En créant un compte ou en utilisant CameraAIWork (le « Service »), vous acceptez les présentes Conditions d’utilisation ainsi que la <a href="/privacy/">Politique de confidentialité</a> qui les accompagne. Si vous n’êtes pas d’accord, veuillez cesser d’utiliser le Service.',
      serviceTitle: 'Description du service', serviceBody: 'CameraAIWork est une plateforme SaaS qui relie des caméras IP sur site à un tableau de bord cloud pour fournir : visionnage en direct, contrôle PTZ, détection de mouvement/personne, reconnaissance faciale, stockage d’images/vidéos d’événements, alertes Telegram et un assistant IA. Certaines fonctionnalités dépendent de votre forfait (Free/Pro) ou nécessitent de connecter vos propres services tiers (Google Drive, S3, Telegram, RunPod).',
      accountTitle: 'Compte & responsabilités', accountList: [
        'Vous êtes responsable de la sécurité de votre mot de passe et de vos clés API.',
        'Vous êtes responsable de l’exactitude des informations de caméra/site que vous fournissez et du matériel que vous connectez.',
        'Vous devez nous informer rapidement en cas de suspicion d’accès non autorisé à votre compte.',
      ],
      lawfulTitle: 'Utilisation licite (vidéosurveillance)', lawfulAlert: 'Vous vous engagez à installer et utiliser des caméras uniquement dans des lieux où vous disposez d’un droit légal de surveillance, et à respecter toutes les lois applicables en matière de surveillance, de confidentialité et de protection des données dans cette juridiction (y compris toute obligation d’informer les personnes filmées, lorsque la loi l’exige). CameraAIWork n’est pas responsable de l’utilisation du Service pour surveiller autrui illégalement, enregistrer sans le consentement requis, ou porter atteinte aux droits à la vie privée d’un tiers.',
      billingTitle: 'Forfaits & facturation', billingList: [
        'Le forfait Free est limité en nombre de sites/caméras, de spectateurs simultanés et de capacité de stockage R2.',
        'Le forfait Pro est facturé de façon récurrente via Stripe ; les tarifs et limites actuels sont affichés dans le tableau de bord lors de l’inscription.',
        'Vous pouvez résilier Pro à tout moment ; le service continue jusqu’à la fin de la période payée, puis repasse en Free.',
        'Nous pouvons modifier les tarifs pour les cycles de facturation futurs, avec préavis.',
      ],
      dataTitle: 'Données & propriété', dataBody: 'Vous êtes propriétaire de toutes les images, vidéos et données de caméra que vous générez. Nous ne traitons ces données que pour fournir le Service comme décrit dans la <a href="/privacy/">Politique de confidentialité</a>, et jamais à d’autres fins que l’exploitation, la sécurité et l’amélioration du Service. Si vous connectez votre propre stockage (S3/Google Drive), ces données résident dans votre propre compte chez ce fournisseur et sont soumises à ses propres conditions.',
      thirdPartiesTitle: 'Services tiers', thirdPartiesBody: 'Le Service peut s’intégrer à Google Drive, à un stockage compatible S3, à Telegram et à RunPod, selon votre choix. Chacun de ces services a ses propres conditions et disponibilité, hors de notre contrôle. Nous ne sommes pas responsables des pannes, interruptions ou pertes de données survenant du côté de ces services tiers.',
      terminationTitle: 'Résiliation', terminationBody: 'Vous pouvez fermer votre compte à tout moment depuis le tableau de bord. Nous pouvons suspendre ou résilier un compte qui viole ces Conditions, en particulier la section Utilisation licite ci-dessus, avec ou sans préavis selon la gravité. Après résiliation, les données sont traitées conformément à la section Conservation & suppression de la Politique de confidentialité.',
      disclaimerTitle: 'Exclusion de garantie', disclaimerBody: 'Le Service est fourni « tel quel », sans garantie d’aucune sorte, y compris de disponibilité continue, de précision de la détection par IA, ou d’adéquation à un usage particulier. CameraAIWork est un outil d’aide à la surveillance, non un substitut à des systèmes de sécurité dédiés pour des situations à haut risque pour la vie ou les biens.',
      liabilityTitle: 'Limitation de responsabilité', liabilityBody: 'Dans toute la mesure permise par la loi, CameraAIWork n’est pas responsable des dommages indirects, accessoires ou consécutifs résultant de l’utilisation ou de l’impossibilité d’utiliser le Service, y compris, sans s’y limiter, la perte de données, l’interruption d’activité, ou un préjudice lié à un événement de sécurité non détecté par le système.',
      lawTitle: 'Droit applicable', lawBody: 'Les présentes Conditions sont régies par le droit du Vietnam, sauf accord écrit contraire entre les parties.',
      changesTitle: 'Modifications des conditions', changesBody: 'Nous pouvons mettre à jour ces Conditions de temps à autre. La date de mise à jour la plus récente est toujours affichée en haut de cette page. Continuer à utiliser le Service après l’entrée en vigueur des modifications signifie que vous les acceptez.',
      contactTitle: 'Contact', contactBody: 'Pour toute question relative à ces Conditions, contactez <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
    ko: {
      dashboard: '대시보드 열기', privacy: '개인정보 처리방침', title: '이용약관', subtitle: '최종 업데이트: 2026년 9월 13일',
      nav: ['약관 동의','서비스 설명','계정 및 책임','합법적 이용','요금제 및 결제','데이터 및 소유권','제3자 서비스','해지','보증의 부인','책임 제한','준거법','약관 변경','문의'],
      acceptTitle: '약관 동의', acceptBody: '계정을 생성하거나 CameraAIWork("서비스")를 이용함으로써 귀하는 본 이용약관 및 부속 <a href="/privacy/">개인정보 처리방침</a>에 동의하는 것입니다. 동의하지 않는 경우 서비스 이용을 중단하십시오.',
      serviceTitle: '서비스 설명', serviceBody: 'CameraAIWork는 현장 IP 카메라를 클라우드 대시보드에 연결하여 실시간 보기, PTZ 제어, 동작/인물 감지, 얼굴 인식, 이벤트 이미지/동영상 저장, Telegram 알림, AI 어시스턴트를 제공하는 SaaS 플랫폼입니다. 일부 기능은 요금제(Free/Pro)에 따라 다르거나 귀하가 직접 제3자 서비스(Google Drive, S3, Telegram, RunPod)를 연결해야 합니다.',
      accountTitle: '계정 및 책임', accountList: [
        '비밀번호와 API 키의 보안 유지는 귀하의 책임입니다.',
        '등록하는 카메라/사이트 정보의 정확성 및 연결하는 하드웨어에 대해 귀하가 책임을 집니다.',
        '계정에 대한 무단 접근이 의심되는 경우 즉시 당사에 알려야 합니다.',
      ],
      lawfulTitle: '합법적 이용(카메라 감시)', lawfulAlert: '귀하는 법적으로 감시할 권한이 있는 장소에만 카메라를 설치·사용하고, 해당 관할권에서 적용되는 모든 감시, 개인정보 보호 및 데이터 보호 법률(법률상 필요한 경우 촬영 대상자에 대한 고지 의무 포함)을 준수할 것에 동의합니다. CameraAIWork는 귀하가 서비스를 이용하여 타인을 불법으로 감시하거나, 필요한 동의 없이 녹음·녹화하거나, 제3자의 프라이버시 권리를 침해하는 것에 대해 책임을 지지 않습니다.',
      billingTitle: '요금제 및 결제', billingList: [
        'Free 요금제는 사이트/카메라 수, 동시 시청자 수, R2 저장 용량에 제한이 있습니다.',
        'Pro 요금제는 Stripe를 통해 정기 결제되며, 현재 가격과 한도는 가입 시 대시보드에 표시됩니다.',
        'Pro는 언제든지 해지할 수 있으며, 결제된 기간이 끝날 때까지 서비스가 유지된 후 Free로 전환됩니다.',
        '향후 결제 주기의 가격은 사전 통지 후 변경될 수 있습니다.',
      ],
      dataTitle: '데이터 및 소유권', dataBody: '귀하가 생성한 모든 이미지, 동영상 및 카메라 데이터는 귀하의 소유입니다. 당사는 <a href="/privacy/">개인정보 처리방침</a>에 설명된 대로 서비스 제공을 위해서만 해당 데이터를 처리하며, 운영·보안·서비스 개선 이외의 목적으로는 사용하지 않습니다. 자체 저장소(S3/Google Drive)를 연결한 경우, 해당 데이터는 해당 제공업체의 귀하 계정 내에 있으며 그 제공업체 자체 약관을 따릅니다.',
      thirdPartiesTitle: '제3자 서비스', thirdPartiesBody: '서비스는 귀하의 선택에 따라 Google Drive, S3 호환 스토리지, Telegram, RunPod와 연동될 수 있습니다. 이들 각각은 당사의 통제 범위를 벗어난 자체 약관과 가용성을 가집니다. 당사는 이러한 제3자 서비스 측에서 발생하는 장애, 중단 또는 데이터 손실에 대해 책임을 지지 않습니다.',
      terminationTitle: '해지', terminationBody: '대시보드에서 언제든지 계정을 해지할 수 있습니다. 당사는 본 약관, 특히 위의 합법적 이용 항목을 위반하는 계정을 위반 정도에 따라 사전 통지 여부와 관계없이 정지하거나 해지할 수 있습니다. 해지 후 데이터는 개인정보 처리방침의 보관 및 삭제 항목에 따라 처리됩니다.',
      disclaimerTitle: '보증의 부인', disclaimerBody: '서비스는 지속적 가용성, AI 감지 정확도, 특정 목적에의 적합성을 포함하여 어떠한 종류의 보증도 없이 "있는 그대로" 제공됩니다. CameraAIWork는 감시를 보조하는 도구이며, 생명이나 재산에 높은 위험이 있는 상황을 위한 전용 보안 시스템을 대체하지 않습니다.',
      liabilityTitle: '책임 제한', liabilityBody: '법이 허용하는 최대 범위 내에서, CameraAIWork는 데이터 손실, 사업 중단, 시스템이 감지하지 못한 보안 사건으로 인한 피해를 포함하되 이에 국한되지 않는, 서비스 이용 또는 이용 불능으로 인한 간접적, 부수적 또는 결과적 손해에 대해 책임을 지지 않습니다.',
      lawTitle: '준거법', lawBody: '본 약관은 당사자 간 별도의 서면 합의가 없는 한 베트남 법률의 적용을 받습니다.',
      changesTitle: '약관 변경', changesBody: '본 약관은 수시로 업데이트될 수 있습니다. 최신 업데이트 날짜는 항상 이 페이지 상단에 표시됩니다. 변경 사항 발효 후에도 서비스를 계속 이용하는 것은 해당 변경에 동의하는 것으로 간주됩니다.',
      contactTitle: '문의', contactBody: '본 약관에 대한 문의는 <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>으로 연락해 주세요.',
    },
    es: {
      dashboard: 'Abrir panel', privacy: 'Política de privacidad', title: 'Términos del servicio', subtitle: 'Última actualización: 13 de septiembre de 2026',
      nav: ['Aceptación de términos','Descripción del servicio','Cuenta y responsabilidades','Uso lícito','Planes y facturación','Datos y propiedad','Servicios de terceros','Terminación','Exclusión de garantías','Limitación de responsabilidad','Ley aplicable','Cambios a estos términos','Contacto'],
      acceptTitle: 'Aceptación de términos', acceptBody: 'Al crear una cuenta o usar CameraAIWork (el "Servicio"), aceptas estos Términos del servicio y la <a href="/privacy/">Política de privacidad</a> que los acompaña. Si no estás de acuerdo, deja de usar el Servicio.',
      serviceTitle: 'Descripción del servicio', serviceBody: 'CameraAIWork es una plataforma SaaS que conecta cámaras IP locales con un panel en la nube para ofrecer: visualización en vivo, control PTZ, detección de movimiento/personas, reconocimiento facial, almacenamiento de imágenes/video de eventos, alertas por Telegram y un asistente de IA. Algunas funciones dependen de tu plan (Free/Pro) o requieren que conectes tus propios servicios de terceros (Google Drive, S3, Telegram, RunPod).',
      accountTitle: 'Cuenta y responsabilidades', accountList: [
        'Eres responsable de mantener seguros tu contraseña y tus claves API.',
        'Eres responsable de la exactitud de la información de cámara/sitio que proporcionas y del hardware que conectas.',
        'Debes notificarnos de inmediato si sospechas un acceso no autorizado a tu cuenta.',
      ],
      lawfulTitle: 'Uso lícito (videovigilancia)', lawfulAlert: 'Aceptas instalar y usar cámaras únicamente en lugares donde tengas derecho legal a vigilar, y cumplir con todas las leyes aplicables de vigilancia, privacidad y protección de datos en esa jurisdicción (incluida cualquier obligación de notificar a las personas grabadas, cuando la ley lo exija). CameraAIWork no es responsable de que uses el Servicio para vigilar ilegalmente a otros, grabar sin el consentimiento requerido, o violar de otro modo los derechos de privacidad de un tercero.',
      billingTitle: 'Planes y facturación', billingList: [
        'El plan Free tiene límites en el número de sitios/cámaras, espectadores simultáneos y capacidad de almacenamiento R2.',
        'El plan Pro se factura de forma recurrente vía Stripe; los precios y límites vigentes se muestran en el panel al momento de la suscripción.',
        'Puedes cancelar Pro en cualquier momento; el servicio continúa hasta el final del período pagado y luego vuelve a Free.',
        'Podemos cambiar los precios para ciclos de facturación futuros, con aviso previo.',
      ],
      dataTitle: 'Datos y propiedad', dataBody: 'Eres el propietario de todas las imágenes, videos y datos de cámara que generas. Solo procesamos esos datos para prestar el Servicio como se describe en la <a href="/privacy/">Política de privacidad</a>, y nunca los usamos para ningún fin más allá de operar, proteger y mejorar el Servicio. Si conectas tu propio almacenamiento (S3/Google Drive), esos datos residen en tu propia cuenta con ese proveedor y están sujetos a sus propios términos.',
      thirdPartiesTitle: 'Servicios de terceros', thirdPartiesBody: 'El Servicio puede integrarse con Google Drive, almacenamiento compatible con S3, Telegram y RunPod, según tu elección. Cada uno de estos tiene sus propios términos y disponibilidad, fuera de nuestro control. No somos responsables de interrupciones, caídas o pérdidas de datos que ocurran del lado de esos servicios de terceros.',
      terminationTitle: 'Terminación', terminationBody: 'Puedes cerrar tu cuenta en cualquier momento desde el panel. Podemos suspender o cancelar una cuenta que infrinja estos Términos, en particular la sección de Uso lícito anterior, con o sin previo aviso según la gravedad. Tras la terminación, los datos se gestionan conforme a la sección de Conservación y eliminación de la Política de privacidad.',
      disclaimerTitle: 'Exclusión de garantías', disclaimerBody: 'El Servicio se proporciona "tal cual", sin garantías de ningún tipo, incluidas las de disponibilidad continua, precisión de la detección por IA, o idoneidad para un propósito particular. CameraAIWork es una herramienta de apoyo a la vigilancia, no un sustituto de sistemas de seguridad dedicados en situaciones de alto riesgo para la vida o los bienes.',
      liabilityTitle: 'Limitación de responsabilidad', liabilityBody: 'En la máxima medida permitida por la ley, CameraAIWork no será responsable de daños indirectos, incidentales o consecuentes derivados del uso o la imposibilidad de usar el Servicio, incluyendo, entre otros, la pérdida de datos, la interrupción del negocio o daños por un evento de seguridad que el sistema no haya detectado.',
      lawTitle: 'Ley aplicable', lawBody: 'Estos Términos se rigen por las leyes de Vietnam, salvo que se acuerde lo contrario por escrito entre las partes.',
      changesTitle: 'Cambios a estos términos', changesBody: 'Podemos actualizar estos Términos periódicamente. La fecha de la actualización más reciente siempre se muestra en la parte superior de esta página. Continuar usando el Servicio después de que los cambios entren en vigor implica que los aceptas.',
      contactTitle: 'Contacto', contactBody: 'Para cualquier pregunta sobre estos Términos, contacta a <a href="mailto:nhantin41@gmail.com">nhantin41@gmail.com</a>.',
    },
  };

  const navIds = ['nav-accept','nav-service','nav-account','nav-lawful','nav-billing','nav-data','nav-third-parties','nav-termination','nav-disclaimer','nav-liability','nav-law','nav-changes','nav-contact'];
  const set = (id, value, html = false) => { const el = document.getElementById(id); if (el) el[html ? 'innerHTML' : 'textContent'] = value; };
  const setList = (id, items) => set(id, items.map((x) => `<li>${x}</li>`).join(''), true);

  function applyLanguage(language) {
    const lang = translations[language] ? language : 'en';
    const t = translations[lang];
    document.documentElement.lang = lang;
    document.title = `${t.title} | CameraAIWork`;
    set('dashboard-link', t.dashboard);
    set('privacy-link', t.privacy);
    set('page-title', t.title);
    set('page-subtitle', t.subtitle);
    navIds.forEach((id, i) => set(id, t.nav[i]));
    set('accept-title', t.acceptTitle); set('accept-body', t.acceptBody, true);
    set('service-title', t.serviceTitle); set('service-body', t.serviceBody);
    set('account-title', t.accountTitle); setList('account-list', t.accountList);
    set('lawful-title', t.lawfulTitle); set('lawful-alert', t.lawfulAlert);
    set('billing-title', t.billingTitle); setList('billing-list', t.billingList);
    set('data-title', t.dataTitle); set('data-body', t.dataBody, true);
    set('third-parties-title', t.thirdPartiesTitle); set('third-parties-body', t.thirdPartiesBody);
    set('termination-title', t.terminationTitle); set('termination-body', t.terminationBody);
    set('disclaimer-title', t.disclaimerTitle); set('disclaimer-body', t.disclaimerBody);
    set('liability-title', t.liabilityTitle); set('liability-body', t.liabilityBody);
    set('law-title', t.lawTitle); set('law-body', t.lawBody);
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
