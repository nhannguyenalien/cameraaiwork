import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../domain/session.dart';

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.read(apiClientProvider)),
);

class AuthRepository {
  const AuthRepository(this.client);

  final ApiClient client;

  Future<Session> login({
    required String email,
    required String password,
  }) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/auth/login',
      method: 'POST',
      data: {'email': email.trim(), 'password': password},
    );
    return Session.fromJson(response.data!);
  }

  Future<Session> signup({
    required String email,
    required String password,
    String? name,
  }) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/auth/signup',
      method: 'POST',
      data: {
        'email': email.trim(),
        'password': password,
        if (name != null && name.trim().isNotEmpty) 'name': name.trim(),
      },
    );
    return Session.fromJson(response.data!);
  }

  Future<void> logout() async {
    await client.request<Map<String, dynamic>>(
      '/api/auth/logout',
      method: 'POST',
    );
  }
}
