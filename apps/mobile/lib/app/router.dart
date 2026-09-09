import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/application/session_controller.dart';
import '../features/auth/presentation/login_screen.dart';
import '../features/cameras/domain/camera.dart';
import '../features/cameras/presentation/camera_detail_screen.dart';
import '../features/dashboard/presentation/dashboard_screen.dart';
import '../features/events/domain/camera_event.dart';
import '../features/events/presentation/event_detail_screen.dart';
import '../features/events/presentation/events_screen.dart';
import '../features/people/presentation/people_screen.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final session = ref.watch(sessionControllerProvider);
  final router = GoRouter(
    initialLocation: '/dashboard',
    redirect: (context, state) {
      if (session.isLoading) return '/loading';
      final signedIn = session.asData?.value != null;
      final authRoute = state.matchedLocation == '/login';
      if (!signedIn && !authRoute) return '/login';
      if (signedIn && (authRoute || state.matchedLocation == '/loading')) {
        return '/dashboard';
      }
      return null;
    },
    routes: [
      GoRoute(
        path: '/loading',
        builder: (_, _) =>
            const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/dashboard', builder: (_, _) => const DashboardScreen()),
      GoRoute(path: '/events', builder: (_, _) => const EventsScreen()),
      GoRoute(path: '/people', builder: (_, _) => const PeopleScreen()),
      GoRoute(
        path: '/event',
        builder: (_, state) {
          final event = state.extra;
          return event is CameraEvent
              ? EventDetailScreen(event: event)
              : const EventsScreen();
        },
      ),
      GoRoute(
        path: '/camera',
        builder: (_, state) {
          final camera = state.extra;
          return camera is CameraSummary
              ? CameraDetailScreen(camera: camera)
              : const DashboardScreen();
        },
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});
