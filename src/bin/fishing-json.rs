//! One JSON request per line, one {ok:...}/{error:...} response per line.
use std::io::{self, BufRead, Write};
fn main() -> io::Result<()> {
    let mut input = io::stdin().lock();
    let mut out = io::BufWriter::new(io::stdout().lock());
    let mut line = Vec::new();
    loop {
        line.clear();
        let mut too_long = false;
        // Drain an oversized record without retaining it. Next record works.
        loop {
            let buf = input.fill_buf()?;
            if buf.is_empty() {
                break;
            }
            let take = buf
                .iter()
                .position(|b| *b == b'\n')
                .map_or(buf.len(), |i| i + 1);
            let done = buf[take - 1] == b'\n';
            if line.len() + take <= fishing_examples::MAX_REQUEST_BYTES {
                line.extend_from_slice(&buf[..take]);
            } else {
                too_long = true;
            }
            input.consume(take);
            if done {
                break;
            }
        }
        if line.is_empty() && !too_long {
            break;
        }
        let result = if too_long {
            br#"{"error":"request exceeds 64 KiB"}"#.to_vec()
        } else {
            fishing_examples::call_json(&line)
        };
        out.write_all(&result)?;
        out.write_all(b"\n")?;
        out.flush()?;
    }
    Ok(())
}
