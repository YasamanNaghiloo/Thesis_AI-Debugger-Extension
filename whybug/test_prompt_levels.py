#!/usr/bin/env python3
"""
Test script to observe adaptive prompt levels.

Run this script multiple times to trigger the same error at different frequencies:
- First run: L0 (fresh error)
- Runs 2-4: L1 (recurring)
- Runs 5+: L2 (chronic)

Instructions:
1. Open this file in VS Code with WhyBug extension enabled
2. Run: python test_prompt_levels.py
3. When NameError appears in terminal, click on it or use "WhyBug: Explain Error"
4. Observe that the AI explanation changes as you repeat the error
"""

def test_prompt_level():
    """Generate a NameError to test adaptive prompts."""
    # This variable is intentionally undefined
    print(f"Result: {undefined_variable}")

if __name__ == "__main__":
    test_prompt_level()
