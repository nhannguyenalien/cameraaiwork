import 'package:camera_ai_mobile/features/auth/domain/session.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses a valid auth response', () {
    final session = Session.fromJson({
      'accountId': 'acct-1',
      'apiKey': 'secret',
    });
    expect(session.accountId, 'acct-1');
    expect(session.apiKey, 'secret');
  });

  test('rejects an invalid auth response', () {
    expect(
      () => Session.fromJson({'accountId': 'acct-1'}),
      throwsFormatException,
    );
  });
}
