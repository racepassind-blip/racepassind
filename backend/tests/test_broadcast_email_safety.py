from __future__ import annotations

import unittest

from app.api.v1.organizer import _broadcast_html_body


class BroadcastEmailSafetyTests(unittest.TestCase):
    def test_message_is_escaped_before_html_rendering(self) -> None:
        html = _broadcast_html_body('<img src=x onerror="alert(1)">\n<strong>still text</strong>')

        self.assertNotIn("<img", html)
        self.assertNotIn("<strong>", html)
        self.assertIn("&lt;img src=x onerror=\"alert(1)\"&gt;", html)
        self.assertIn("&lt;strong&gt;still text&lt;/strong&gt;", html)
        self.assertIn("<br>", html)


if __name__ == "__main__":
    unittest.main()
