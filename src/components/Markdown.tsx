import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

// Imported webpages carry inline HTML (footnote <sup>/<a>, <mark>, etc.) that
// react-markdown drops by default. `raw` renders it — sanitized, since web
// content is untrusted. Chat/search markdown is HTML-free, so they omit it.
const RAW_PLUGINS = [rehypeRaw, rehypeSanitize];

export default function Markdown({ children, raw = false }: { children: string; raw?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={raw ? RAW_PLUGINS : undefined}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
