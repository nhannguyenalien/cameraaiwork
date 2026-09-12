class CameraSummary {
  const CameraSummary({
    required this.cameraId,
    required this.stream,
    required this.siteId,
    this.cameraName,
    this.siteName,
  });

  final String cameraId;
  final String stream;
  final String siteId;
  final String? cameraName;
  final String? siteName;

  String get displayName =>
      cameraName?.trim().isNotEmpty == true ? cameraName! : cameraId;

  String get siteDisplayName =>
      siteName?.trim().isNotEmpty == true ? siteName! : siteId;

  factory CameraSummary.fromJson(Map<String, dynamic> json) {
    final cameraId = json['cameraId'];
    final stream = json['stream'];
    final siteId = json['siteId'];
    if (cameraId is! String || stream is! String || siteId is! String) {
      throw const FormatException('Dữ liệu camera không hợp lệ');
    }
    return CameraSummary(
      cameraId: cameraId,
      stream: stream,
      siteId: siteId,
      cameraName: json['cameraName'] as String?,
      siteName: json['siteName'] as String?,
    );
  }
}

class CameraStatus {
  const CameraStatus({
    required this.relayOnline,
    required this.cameraOnline,
    required this.status,
    required this.message,
    required this.controls,
    this.latencyMs,
  });

  final bool relayOnline;
  final bool cameraOnline;
  final String status;
  final String message;
  final Map<String, dynamic> controls;
  final int? latencyMs;

  bool get supportsPtz => controls['ptz'] == true;

  factory CameraStatus.fromJson(Map<String, dynamic> json) {
    return CameraStatus(
      relayOnline: json['relayOnline'] == true,
      cameraOnline: json['cameraOnline'] == true,
      status: json['status']?.toString() ?? 'unknown',
      message: json['message']?.toString() ?? 'Không có thông tin trạng thái',
      controls: json['controls'] is Map
          ? (json['controls'] as Map).cast<String, dynamic>()
          : const {},
      latencyMs: (json['latencyMs'] as num?)?.toInt(),
    );
  }
}

class LiveSession {
  const LiveSession({
    required this.url,
    required this.expiresAt,
    required this.viewerLimit,
  });

  final Uri url;
  final DateTime expiresAt;
  final int viewerLimit;

  factory LiveSession.fromJson(Map<String, dynamic> json) {
    final url = Uri.tryParse(json['url']?.toString() ?? '');
    final expiresAt = json['expiresAt'];
    final viewerLimit = json['viewerLimit'];
    if (url == null ||
        !url.hasScheme ||
        expiresAt is! num ||
        viewerLimit is! num) {
      throw const FormatException('Phiên live không hợp lệ');
    }
    return LiveSession(
      url: url,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(
        expiresAt.toInt() * 1000,
        isUtc: true,
      ),
      viewerLimit: viewerLimit.toInt(),
    );
  }
}
