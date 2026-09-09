import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../domain/session.dart';

final sessionStoreProvider = Provider<SessionStore>(
  (_) => const SessionStore(FlutterSecureStorage()),
);

class SessionStore {
  const SessionStore(this.storage);

  static const _accountKey = 'cameraai.account_id';
  static const _tokenKey = 'cameraai.api_key';

  final FlutterSecureStorage storage;

  Future<Session?> read() async {
    final values = await storage.readAll();
    final accountId = values[_accountKey];
    final apiKey = values[_tokenKey];
    if (accountId == null || apiKey == null) return null;
    return Session(accountId: accountId, apiKey: apiKey);
  }

  Future<String?> readToken() => storage.read(key: _tokenKey);

  Future<void> write(Session session) async {
    await Future.wait([
      storage.write(key: _accountKey, value: session.accountId),
      storage.write(key: _tokenKey, value: session.apiKey),
    ]);
  }

  Future<void> clear() async {
    await Future.wait([
      storage.delete(key: _accountKey),
      storage.delete(key: _tokenKey),
    ]);
  }
}
