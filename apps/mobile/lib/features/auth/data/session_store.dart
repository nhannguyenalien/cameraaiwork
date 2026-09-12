import 'dart:io' show Platform;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../domain/session.dart';

final sessionStoreProvider = Provider<SessionStore>(
  (_) => SessionStore(Platform.isMacOS ? _PlainTextStore() : _KeychainStore()),
);

// macOS keychain items require a real Apple Developer signing identity
// (app-identifier/application-groups/keychain-access-groups entitlement);
// ad-hoc builds fail every write with errSecMissingEntitlement (-34018).
// Fall back to unencrypted local storage on macOS until the app is signed
// with a paid Developer ID.
abstract class _TokenStorage {
  Future<String?> read(String key);
  Future<Map<String, String>> readAll(Set<String> keys);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class _KeychainStore implements _TokenStorage {
  const _KeychainStore();

  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<Map<String, String>> readAll(Set<String> keys) => _storage.readAll();

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

class _PlainTextStore implements _TokenStorage {
  const _PlainTextStore();

  @override
  Future<String?> read(String key) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key);
  }

  @override
  Future<Map<String, String>> readAll(Set<String> keys) async {
    final prefs = await SharedPreferences.getInstance();
    final result = <String, String>{};
    for (final key in keys) {
      final value = prefs.getString(key);
      if (value != null) result[key] = value;
    }
    return result;
  }

  @override
  Future<void> write(String key, String value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
  }

  @override
  Future<void> delete(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(key);
  }
}

class SessionStore {
  // ignore: library_private_types_in_public_api
  const SessionStore(this._storage);

  static const _accountKey = 'cameraai.account_id';
  static const _tokenKey = 'cameraai.api_key';

  final _TokenStorage _storage;

  Future<Session?> read() async {
    final values = await _storage.readAll({_accountKey, _tokenKey});
    final accountId = values[_accountKey];
    final apiKey = values[_tokenKey];
    if (accountId == null || apiKey == null) return null;
    return Session(accountId: accountId, apiKey: apiKey);
  }

  Future<String?> readToken() => _storage.read(_tokenKey);

  Future<void> write(Session session) async {
    await Future.wait([
      _storage.write(_accountKey, session.accountId),
      _storage.write(_tokenKey, session.apiKey),
    ]);
  }

  Future<void> clear() async {
    await Future.wait([
      _storage.delete(_accountKey),
      _storage.delete(_tokenKey),
    ]);
  }
}
