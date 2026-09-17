"""
Simple JSON-backed Vector Database.

No vector DB / numpy / faiss dependencies are used - only the Python
standard library plus `sentence-transformers`, which is required to
run the requested embedding model
(sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2).

Storage format: /data/vectors.json -> a JSON array of records:
    {"id": <str>, "content": <str>, "embedding": [<float>, ...], "source": <str>}

Input: a .md (Markdown) file. Markdown syntax (headers, links, code
fences, emphasis markers, etc.) is stripped before sentence chunking
so it doesn't pollute the embedded text.
"""

import os
import re
import json
import math
import uuid
from dotenv import load_dotenv
load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

class VectorDB:
    def __init__(
        self,
        data_dir="data",
        db_file="vectors.json",
        # model_name="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    ):
        self.data_dir = data_dir
        self.db_path = os.path.join(self.data_dir, db_file)
        os.makedirs(self.data_dir, exist_ok=True)

        # Imported lazily so that chunking / search-logic can be unit
        # tested without needing the (heavy) model downloaded.
        # from sentence_transformers import SentenceTransformer
        # self.model = SentenceTransformer(model_name)

        from google import genai
        self.embedder = genai.Client(api_key=GOOGLE_API_KEY)
        self.records = self._load()

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def _load(self):
        if os.path.exists(self.db_path):
            with open(self.db_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return []

    def _save(self):
        with open(self.db_path, "w", encoding="utf-8") as f:
            json.dump(self.records, f, ensure_ascii=False, indent=2)

    # ------------------------------------------------------------------ #
    # Markdown loading
    # ------------------------------------------------------------------ #
    @staticmethod
    def _strip_markdown(text):
        """
        Lightweight Markdown -> plain text cleanup so that sentence
        chunking isn't thrown off by syntax noise. Not a full parser -
        just enough to keep the readable text intact.
        """
        # Drop fenced code blocks entirely (``` ... ```)
        text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
        # Drop inline code spans, keep the code text
        text = re.sub(r"`([^`]+)`", r"\1", text)
        # Images: ![alt](url) -> alt
        text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
        # Links: [text](url) -> text
        text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
        # Headers: '### Title' -> 'Title.' (treat as its own sentence)
        text = re.sub(r"^\s{0,3}#{1,6}\s*(.+)$", r"\1.", text, flags=re.MULTILINE)
        # Bold / italic / strikethrough markers
        text = re.sub(r"(\*\*\*|\*\*|\*|___|__|_|~~)", "", text)
        # Blockquote markers
        text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.MULTILINE)
        # List bullets / numbering -> keep text
        text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
        text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
        # Horizontal rules
        text = re.sub(r"^\s*([-*_]\s*){3,}$", " ", text, flags=re.MULTILINE)
        # Table pipes -> spaces
        text = text.replace("|", " ")
        # Collapse excess whitespace/newlines
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{2,}", "\n", text)
        return text.strip()

    def load_markdown_file(self, file_path, strip_syntax=True):
        """
        Read a .md file and return its (optionally cleaned) text content.
        """
        with open(file_path, "r", encoding="utf-8") as f:
            raw = f.read()
        return self._strip_markdown(raw) if strip_syntax else raw

    # ------------------------------------------------------------------ #
    # Chunking
    # ------------------------------------------------------------------ #
    def chunk(self, text, chunk_size=3, overlap=1):

        """
        Simple sentence-based chunking with overlap.

        chunk_size : number of sentences per chunk
        overlap    : number of sentences shared between consecutive chunks

        Sentences are split on '.', '!', '?' (and the Vietnamese/CJK-safe
        ellipsis '…'), followed by whitespace, so it works reasonably well
        for both English and Vietnamese text.
        """
        if overlap >= chunk_size:
            raise ValueError("overlap must be smaller than chunk_size")

        sentences = re.split(r"(?<=[.!?…])\s+", text.strip())
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            return []

        chunks = []
        step = chunk_size - overlap
        i = 0
        while i < len(sentences):
            piece = sentences[i:i + chunk_size]
            if not piece:
                break
            chunks.append(" ".join(piece))
            if i + chunk_size >= len(sentences):
                break
            i += step
        return chunks

    # ------------------------------------------------------------------ #
    # Embedding
    # ------------------------------------------------------------------ #
    def embed(self, texts):
        """
        Embed a single string or a list of strings.
        Returns a single vector (list[float]) or a list of vectors.
        """
        single = isinstance(texts, str)
        inputs = [texts] if single else texts

        # vectors = self.model.encode(inputs, convert_to_numpy=False)
        # vectors = [v.tolist() if hasattr(v, "tolist") else list(v) for v in vectors]

        from google.genai import types
        vectors = []
        for input in inputs:
            response = self.embedder.models.embed_content(
                model="gemini-embedding-2",
                contents=input,
                config=types.EmbedContentConfig(output_dimensionality=512)
            )
            vectors.append(response.embeddings[0].values)

        return vectors[0] if single else vectors

    # ------------------------------------------------------------------ #
    # Insert
    # ------------------------------------------------------------------ #
    def insert(self, content, chunk_size=10, overlap=3):
        """
        Chunk `content`, embed each chunk, and persist to /data/vectors.json.
        Returns the list of inserted records.
        """
        chunks = self.chunk(content, chunk_size=chunk_size, overlap=overlap)
        if not chunks:
            return []

        embeddings = self.embed(chunks)
        inserted = []
        for chunk_text, emb in zip(chunks, embeddings):
            record = {
                "id": str(uuid.uuid4()),
                "content": chunk_text,
                "embedding": emb,
            }
            self.records.append(record)
            inserted.append(record)

        self._save()
        return inserted

    def insert_file(self, file_path, chunk_size=10, overlap=3, strip_syntax=True):
        """
        Read a .md file, chunk + embed its content, and persist it.
        Each stored record also carries a "source" field (the filename)
        so results can be traced back to the original document.
        """
        text = self.load_markdown_file(file_path, strip_syntax=strip_syntax)
        chunks = self.chunk(text, chunk_size=chunk_size, overlap=overlap)
        if not chunks:
            return []

        embeddings = self.embed(chunks)
        source = os.path.basename(file_path)
        inserted = []
        for chunk_text, emb in zip(chunks, embeddings):
            record = {
                "id": str(uuid.uuid4()),
                "content": chunk_text,
                "embedding": emb,
                "source": source,
            }
            self.records.append(record)
            inserted.append(record)

        self._save()
        return inserted

    # ------------------------------------------------------------------ #
    # Search
    # ------------------------------------------------------------------ #
    @staticmethod
    def _cosine_similarity(v1, v2):
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = math.sqrt(sum(a * a for a in v1))
        norm2 = math.sqrt(sum(b * b for b in v2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return dot / (norm1 * norm2)

    def search(self, query, top_k=2):
        """
        Return the top_k most similar chunks to `query`, sorted by
        cosine similarity descending.
        """
        if not self.records:
            return []

        query_emb = self.embed(query)
        scored = [
            (self._cosine_similarity(query_emb, r["embedding"]), r)
            for r in self.records
        ]
        scored.sort(key=lambda x: x[0], reverse=True)

        return [
            {"id": r["id"], "content": r["content"], "score": sim}
            for sim, r in scored[:top_k]
        ]


# -------------------------------------------------------------------- #
# Example usage
# -------------------------------------------------------------------- #
if __name__ == "__main__":

    db = VectorDB(data_dir="data")

    # import sys
    # md_path = sys.argv[1] if len(sys.argv) > 1 else "example.md"
    # md_path = "data/stock.md"
    # db.insert_file(md_path, chunk_size=35, overlap=5)

    results = db.search("Tạo tài khoản", top_k=2)
    for r in results:
        print(f"[{r['score']:.4f}] ({r['id'][:8]}) {r['content']}")
