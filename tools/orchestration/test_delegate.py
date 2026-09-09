"""Boundary tests: no inference, credentials or network required."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import delegate


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name).resolve()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        (self.repo / 'sample.ts').write_text('export const answer = 42\n')
        (self.repo / 'CLAUDE.md').write_text('One task per prompt.\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', '.'], check=True)

    def test_numbered_evidence_and_rules(self):
        prompt, hashes = delegate.packet(self.repo, ['sample.ts'], 'Find the answer')
        self.assertIn('sample.ts:1: export const answer = 42', prompt)
        self.assertIn('CLAUDE.md:1: One task per prompt.', prompt)
        self.assertEqual(set(hashes), {'sample.ts', 'CLAUDE.md'})

    def test_untracked_hidden_traversal_and_symlink_refused(self):
        (self.repo / 'untracked.ts').write_text('untracked')
        (self.repo / 'link.ts').symlink_to(self.repo / 'sample.ts')
        for path in ['untracked.ts', '.env', '../outside.ts', 'link.ts', '/etc/passwd']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                delegate.packet(self.repo, [path], 'Find the answer')

    def test_known_secret_and_token_refused(self):
        for text, known in [('sk-' + 'x' * 30, []), ('opaque-sensitive-value', ['opaque-sensitive-value'])]:
            with self.assertRaises(ValueError):
                delegate.screen(text, known)

    def test_secret_in_source_is_not_sent(self):
        (self.repo / 'sample.ts').write_text('sk-' + 'x' * 30)
        with self.assertRaises(ValueError):
            delegate.packet(self.repo, ['sample.ts'], 'Review')

    def test_context_and_task_limits(self):
        (self.repo / 'sample.ts').write_text('x' * 60001)
        with self.assertRaises(ValueError):
            delegate.packet(self.repo, ['sample.ts'], 'Review')
        with self.assertRaises(ValueError):
            delegate.packet(self.repo, ['CLAUDE.md'], 'x' * 8001)

    def test_provider_and_hook_environment_removed(self):
        with patch.dict(os.environ, {'ANTHROPIC_API_KEY': 'test', 'CLAUDE_CODE_OAUTH_TOKEN': 'test', 'OPENROUTER_API_KEY': 'test', 'NODE_OPTIONS': 'test', 'HERMES_KANBAN_TASK': 'test'}):
            env = delegate.clean_env()
            self.assertFalse(set(env) & {'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENROUTER_API_KEY', 'NODE_OPTIONS', 'HERMES_KANBAN_TASK'})

    def test_task_text_is_not_shell_executed(self):
        marker = self.repo / 'unexpected'
        text = '$(touch %s)' % marker
        answer = delegate.run(['cat'], cwd=self.repo, input=text)
        self.assertEqual(answer, text)
        self.assertFalse(marker.exists())

    def test_raw_error_is_withheld(self):
        with self.assertRaises(ValueError) as result:
            delegate.run(['sh', '-c', 'echo sensitive-diagnostic >&2; exit 1'], cwd=self.repo)
        self.assertNotIn('sensitive-diagnostic', str(result.exception))


class WorktreeIsolation(unittest.TestCase):
    def test_new_tree_uses_main_and_preserves_original_edits(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            source, destination = base / 'source', base / 'worker'
            subprocess.run(['git', 'init', '-q', '-b', 'main', str(source)], check=True)
            def git(*args):
                return subprocess.run(['git', '-C', str(source), *args], check=True, capture_output=True, text=True).stdout
            (source / 'tracked.txt').write_text('base')
            git('add', '.')
            git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture')
            git('remote', 'add', 'origin', str(source))
            (source / 'tracked.txt').write_text('unrelated edit')
            script = Path(__file__).with_name('create-worktree')
            subprocess.run([str(script), str(source), 'worker/test', str(destination)], check=True, capture_output=True)
            self.assertEqual((destination / 'tracked.txt').read_text(), 'base')
            self.assertEqual((source / 'tracked.txt').read_text(), 'unrelated edit')
            self.assertEqual(git('branch', '--show-current').strip(), 'main')
            refusal = subprocess.run([str(script), str(source), 'worker/again', str(destination)], capture_output=True)
            self.assertNotEqual(refusal.returncode, 0)


if __name__ == '__main__':
    unittest.main()
