import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../events/data/event_repository.dart';
import '../../events/domain/camera_event.dart';

class PeopleScreen extends ConsumerStatefulWidget {
  const PeopleScreen({super.key});

  @override
  ConsumerState<PeopleScreen> createState() => _PeopleScreenState();
}

class _PeopleScreenState extends ConsumerState<PeopleScreen> {
  String _query = '';

  Future<void> _rename(EventPerson person) async {
    final controller = TextEditingController(text: person.label ?? '');
    final label = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Đặt tên người'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            labelText: 'Tên',
            hintText: 'Ví dụ: Bố, Mẹ, Người giao hàng',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Huỷ'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Lưu'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (label == null) return;
    try {
      await ref.read(eventRepositoryProvider).renamePerson(person.id, label);
      ref.invalidate(peopleProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(label.isEmpty ? 'Đã xoá tên.' : 'Đã lưu tên.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final people = ref.watch(peopleProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mọi người')),
      body: people.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off, size: 48),
                const SizedBox(height: 12),
                Text(error.toString(), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => ref.invalidate(peopleProvider),
                  child: const Text('Thử lại'),
                ),
              ],
            ),
          ),
        ),
        data: (items) {
          final query = _query.trim().toLowerCase();
          final filtered = query.isEmpty
              ? items
              : items
                    .where(
                      (person) =>
                          person.displayName.toLowerCase().contains(query) ||
                          person.id.toLowerCase().contains(query),
                    )
                    .toList(growable: false);
          return RefreshIndicator(
            onRefresh: () => ref.refresh(peopleProvider.future),
            child: ListView(
              padding: const EdgeInsets.all(12),
              children: [
                TextField(
                  onChanged: (value) => setState(() => _query = value),
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: 'Tìm theo tên',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                if (filtered.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 100),
                    child: Column(
                      children: [
                        Icon(Icons.person_search_outlined, size: 52),
                        SizedBox(height: 12),
                        Text('Không tìm thấy người phù hợp.'),
                      ],
                    ),
                  )
                else
                  ...filtered.map(
                    (person) => _PersonCard(
                      person: person,
                      onRename: () => _rename(person),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PersonCard extends ConsumerWidget {
  const _PersonCard({required this.person, required this.onRename});
  final EventPerson person;
  final VoidCallback onRename;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final previewId = person.previewEventId;
    final previewBytes = previewId == null
        ? null
        : ref.watch(eventImageProvider(previewId)).asData?.value;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(
            context,
          ).colorScheme.surfaceContainerHighest,
          backgroundImage: previewBytes == null
              ? null
              : MemoryImage(previewBytes),
          child: previewBytes == null ? const Icon(Icons.person_outline) : null,
        ),
        title: Text(person.displayName),
        subtitle: Text(
          '${person.seenCount} lần xuất hiện${person.lastSeenAt == null ? '' : ' · ${_dateLabel(person.lastSeenAt!)}'}',
        ),
        trailing: IconButton(
          tooltip: 'Đổi tên',
          onPressed: onRename,
          icon: const Icon(Icons.edit_outlined),
        ),
      ),
    );
  }
}

String _dateLabel(DateTime value) {
  final date = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(date.day)}/${two(date.month)}/${date.year}';
}
