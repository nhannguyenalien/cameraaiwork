class Session {
  const Session({required this.accountId, required this.apiKey});

  final String accountId;
  final String apiKey;

  factory Session.fromJson(Map<String, dynamic> json) {
    final accountId = json['accountId'];
    final apiKey = json['apiKey'];
    if (accountId is! String || apiKey is! String) {
      throw const FormatException('Phản hồi đăng nhập không hợp lệ');
    }
    return Session(accountId: accountId, apiKey: apiKey);
  }
}
