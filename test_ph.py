from flask import Flask, request, render_template_string

app = Flask(__name__)

HTML = """
<!DOCTYPE html>
<html>
<head>
    <title>Embed Test</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 40px;
        }

        iframe {
            width: 800px;
            height: 450px;
            border: none;
        }
    </style>
</head>
<body>

    <h1>Embed Test</h1>

    <form method="POST">
        <button type="submit">Reload</button>
    </form>

    <br>

    <iframe
        src="{{ embed_url }}"
        allowfullscreen>
    </iframe>

</body>
</html>
"""

@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        print("POST received")

    embed_url = "https://www.pornhub.com/embed/6a249663d028f"

    return render_template_string(
        HTML,
        embed_url=embed_url
    )

if __name__ == "__main__":
    app.run(debug=True)