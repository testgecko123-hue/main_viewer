from flask import Flask, render_template_string, request

app = Flask(__name__)

from urllib.parse import urlparse, parse_qs

def extract_viewkey(url):
    parsed = urlparse(url)
    params = parse_qs(parsed.query)

    return params.get("viewkey", [None])[0]


HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Video Viewer</title>
</head>
<body>
    <h1>Video Viewer</h1>

    <form method="POST">
        <input
            type="text"
            name="video_url"
            placeholder="Paste Pornhub URL"
            style="width:600px"
            required>
        <button type="submit">Load</button>
    </form>

    {% if view_key %}
    <hr>
    <iframe src="https://www.pornhub.com/embed/6a16fbec2d5a6" frameborder="0" width="560" height="315" scrolling="no" allowfullscreen></iframe>
    {% endif %}
</body>
</html>
"""

@app.route("/", methods=["GET", "POST"])
def index():
    video_url = None

    if request.method == "POST":
        video_url = request.form.get("video_url")

    return render_template_string(
        HTML,
        view_key=extract_viewkey(video_url)
    )

if __name__ == "__main__":
    app.run(debug=True)