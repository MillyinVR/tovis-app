"""Private subprocess adapter for the locally installed Hermes runtime."""
import contextlib
import io
import logging
import os
from pathlib import Path
import sys


def main():
    prompt = sys.stdin.read()
    # Capture runtime diagnostics, including third-party errors; emit final text only.
    logging.disable(logging.CRITICAL)
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        sys.path.insert(0, str(Path.home() / '.hermes/hermes-agent'))
        from run_agent import AIAgent
        agent = AIAgent(
            model='z-ai/glm-5.3', provider='openrouter',
            base_url='https://openrouter.ai/api/v1', api_key=os.environ['OPENROUTER_API_KEY'],
            enabled_toolsets=[], max_iterations=1, max_tokens=2400,
            reasoning_config={'effort': 'low'}, run_budget_seconds=180,
            save_trajectories=False, quiet_mode=True, verbose_logging=False,
            skip_context_files=True, skip_memory=True, skip_background_review=True,
            load_soul_identity=False, fallback_model=None, session_db=None,
        )
        if agent.tools:
            raise RuntimeError('Tool-free invariant failed')
        result = agent.run_conversation(prompt)
        if result.get('error') or not result.get('final_response'):
            raise RuntimeError('No successful final response')
        answer = result['final_response']
    print(answer)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Hermes worker failed; raw provider diagnostics withheld.', file=sys.stderr)
        sys.exit(1)
