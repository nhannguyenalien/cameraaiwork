import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../cameras/domain/camera.dart';
import '../data/event_repository.dart';
import '../domain/camera_event.dart';

class EventsScreen extends ConsumerStatefulWidget {
  const EventsScreen({super.key});

  @override
  ConsumerState<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends ConsumerState<EventsScreen> {
  final _events = <CameraEvent>[];
  List<CameraSummary> _cameras = const [];
  List<EventPerson> _people = const [];
  String? _camera;
  String? _person;
  String? _type;
  String? _cursor;
  Object? _error;
  bool _loading = true;
  bool _loadingMore = false;

  @override
  void initState() {
    super.initState();
    _loadInitial();
  }

  Future<void> _loadInitial() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = ref.read(eventRepositoryProvider);
      final result = await Future.wait([
        repository.list(camera: _camera, person: _person, type: _type),
        repository.cameras(),
        repository.people(),
      ]);
      if (!mounted) return;
      final page = result[0] as EventPage;
      setState(() {
        _events
          ..clear()
          ..addAll(page.items);
        _cursor = page.nextCursor;
        _cameras = result[1] as List<CameraSummary>;
        _people = result[2] as List<EventPerson>;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_cursor == null || _loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      final page = await ref
          .read(eventRepositoryProvider)
          .list(cursor: _cursor, camera: _camera, person: _person, type: _type);
      if (!mounted) return;
      setState(() {
        _events.addAll(page.items);
        _cursor = page.nextCursor;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _showFilters() async {
    var camera = _camera;
    var person = _person;
    var type = _type;
    final apply = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              20,
              20,
              20 + MediaQuery.viewInsetsOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Lọc sự kiện',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String?>(
                  initialValue: camera,
                  decoration: const InputDecoration(labelText: 'Camera'),
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Tất cả camera'),
                    ),
                    ..._cameras.map(
                      (item) => DropdownMenuItem(
                        value: item.stream,
                        child: Text(item.displayName),
                      ),
                    ),
                  ],
                  onChanged: (value) => setSheetState(() => camera = value),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: person,
                  decoration: const InputDecoration(labelText: 'Người'),
                  items: [
                    const DropdownMenuItem(
                      value: null,
                      child: Text('Tất cả mọi người'),
                    ),
                    ..._people.map(
                      (item) => DropdownMenuItem(
                        value: item.id,
                        child: Text(item.displayName),
                      ),
                    ),
                  ],
                  onChanged: (value) => setSheetState(() => person = value),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: type,
                  decoration: const InputDecoration(labelText: 'Loại'),
                  items: const [
                    DropdownMenuItem(value: null, child: Text('Tất cả loại')),
                    DropdownMenuItem(
                      value: 'motion',
                      child: Text('Chuyển động'),
                    ),
                    DropdownMenuItem(value: 'person', child: Text('Có người')),
                  ],
                  onChanged: (value) => setSheetState(() => type = value),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: const Text('Áp dụng'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (apply == true) {
      setState(() {
        _camera = camera;
        _person = person;
        _type = type;
      });
      await _loadInitial();
    }
  }

  @override
  Widget build(BuildContext context) {
    final activeFilters = [_camera, _person, _type].whereType<String>().length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sự kiện'),
        actions: [
          Badge(
            isLabelVisible: activeFilters > 0,
            label: Text('$activeFilters'),
            child: IconButton(
              tooltip: 'Bộ lọc',
              onPressed: _loading ? null : _showFilters,
              icon: const Icon(Icons.filter_list),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, size: 48),
              const SizedBox(height: 12),
              Text(_error.toString(), textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _loadInitial,
                child: const Text('Thử lại'),
              ),
            ],
          ),
        ),
      );
    }
    if (_events.isEmpty) {
      return RefreshIndicator(
        onRefresh: _loadInitial,
        child: ListView(
          children: const [
            SizedBox(height: 220),
            Icon(Icons.event_busy, size: 52),
            SizedBox(height: 12),
            Center(child: Text('Không có sự kiện phù hợp.')),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadInitial,
      child: ListView.builder(
        padding: const EdgeInsets.all(12),
        itemCount: _events.length + (_cursor == null ? 0 : 1),
        itemBuilder: (context, index) {
          if (index == _events.length) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: OutlinedButton(
                onPressed: _loadingMore ? null : _loadMore,
                child: _loadingMore
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Tải thêm'),
              ),
            );
          }
          return _EventCard(event: _events[index]);
        },
      ),
    );
  }
}

class _EventCard extends ConsumerWidget {
  const _EventCard({required this.event});
  final CameraEvent event;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/event', extra: event),
        child: Row(
          children: [
            SizedBox(
              width: 124,
              height: 92,
              child: event.hasImage
                  ? ref
                        .watch(eventImageProvider(event.id))
                        .when(
                          data: (bytes) =>
                              Image.memory(bytes, fit: BoxFit.cover),
                          loading: () => const Center(
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          error: (_, _) =>
                              const Icon(Icons.broken_image_outlined),
                        )
                  : const ColoredBox(
                      color: Color(0xFFE8EAED),
                      child: Icon(Icons.image_not_supported_outlined),
                    ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      event.personLabel ?? _typeLabel(event.type),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      event.camera,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            _dateLabel(event.timestamp),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        if (event.hasVideo)
                          const Icon(Icons.play_circle_outline, size: 20),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _typeLabel(String type) => switch (type) {
  'motion' => 'Chuyển động',
  'person' => 'Phát hiện người',
  _ => type,
};

String _dateLabel(DateTime value) {
  final date = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(date.hour)}:${two(date.minute)} · ${two(date.day)}/${two(date.month)}/${date.year}';
}
