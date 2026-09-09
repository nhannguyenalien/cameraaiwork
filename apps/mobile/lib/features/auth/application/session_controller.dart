import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../data/session_store.dart';
import '../domain/session.dart';

final sessionControllerProvider =
    AsyncNotifierProvider<SessionController, Session?>(SessionController.new);

class SessionController extends AsyncNotifier<Session?> {
  @override
  Future<Session?> build() => ref.read(sessionStoreProvider).read();

  Future<void> login({required String email, required String password}) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final session = await ref
          .read(authRepositoryProvider)
          .login(email: email, password: password);
      await ref.read(sessionStoreProvider).write(session);
      return session;
    });
  }

  Future<void> signup({
    required String email,
    required String password,
    String? name,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final session = await ref
          .read(authRepositoryProvider)
          .signup(email: email, password: password, name: name);
      await ref.read(sessionStoreProvider).write(session);
      return session;
    });
  }

  Future<void> logout() async {
    try {
      await ref.read(authRepositoryProvider).logout();
    } finally {
      await ref.read(sessionStoreProvider).clear();
      state = const AsyncData(null);
    }
  }
}
