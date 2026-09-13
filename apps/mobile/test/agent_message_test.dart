import 'package:camera_ai_mobile/features/agent/domain/agent_message.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses a chat turn with proposals and attachments', () {
    final turn = AgentChatTurn.fromJson({
      'answer': 'Đã tìm thấy 2 sự kiện.',
      'provider': 'openai',
      'model': 'gpt-5-mini',
      'proposals': [
        {
          'action': 'move_camera',
          'args': {'siteId': 'st-1', 'cameraId': 'cam-1', 'command': 'up'},
        },
      ],
      'attachments': [
        {'eventId': '4879', 'kind': 'image'},
      ],
      'conversationContext': null,
    });

    expect(turn.answer, 'Đã tìm thấy 2 sự kiện.');
    expect(turn.proposals.single.action, 'move_camera');
    expect(turn.proposals.single.args['command'], 'up');
    expect(turn.attachments.single.eventId, 4879);
    expect(turn.attachments.single.isImage, isTrue);
  });

  test('parses a message row id from a stringified BIGINT', () {
    final row = AgentMessageRow.fromJson({
      'id': '42',
      'role': 'assistant',
      'content': 'Camera online.',
      'source': 'patrol',
      'created_at': '2026-09-13T01:02:03.000Z',
    });

    expect(row.id, 42);
    expect(row.isPatrol, isTrue);
  });

  test('rejects a message row missing required fields', () {
    expect(
      () => AgentMessageRow.fromJson({'role': 'user'}),
      throwsFormatException,
    );
  });
}
