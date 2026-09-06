use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag};
use std::cell::RefCell;
use std::slice;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const RESET: &str = "\x1b[0m";
const NORMAL: &str = "\x1b[38;2;184;230;218m";
const HEADING: &str = "\x1b[1;38;2;0;255;204m";
const STRONG: &str = "\x1b[1;38;2;190;255;70m";
const EMPHASIS: &str = "\x1b[3;38;2;110;220;255m";
const CODE: &str = "\x1b[38;2;255;214;120m";
const LINK: &str = "\x1b[4;38;2;60;220;255m";
const QUOTE: &str = "\x1b[38;2;100;255;165m";
const DIM: &str = "\x1b[2;38;2;110;155;150m";
const STRIKE: &str = "\x1b[9;38;2;140;175;170m";

thread_local! {
    static RESULT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone, Copy)]
enum InlineStyle {
    Normal,
    Strong,
    Emphasis,
    Code,
    Link,
    Quote,
    Dim,
    Strike,
    Heading,
}

impl InlineStyle {
    fn ansi(self) -> &'static str {
        match self {
            Self::Normal => NORMAL,
            Self::Strong => STRONG,
            Self::Emphasis => EMPHASIS,
            Self::Code => CODE,
            Self::Link => LINK,
            Self::Quote => QUOTE,
            Self::Dim => DIM,
            Self::Strike => STRIKE,
            Self::Heading => HEADING,
        }
    }
}

struct ListState {
    next: Option<u64>,
}

struct Renderer {
    width: usize,
    lines: Vec<String>,
    line: String,
    visible: usize,
    first_prefix: String,
    continuation_prefix: String,
    prefix_written: bool,
    styles: Vec<InlineStyle>,
    lists: Vec<ListState>,
    quote_depth: usize,
    heading: Option<HeadingLevel>,
    code_block: bool,
    table: bool,
    table_head: bool,
    link_target: Option<String>,
    image_target: Option<String>,
    pending_space: bool,
}

impl Renderer {
    fn new(width: usize) -> Self {
        Self {
            width: width.clamp(24, 240),
            lines: Vec::new(),
            line: String::new(),
            visible: 0,
            first_prefix: String::new(),
            continuation_prefix: String::new(),
            prefix_written: false,
            styles: vec![InlineStyle::Normal],
            lists: Vec::new(),
            quote_depth: 0,
            heading: None,
            code_block: false,
            table: false,
            table_head: false,
            link_target: None,
            image_target: None,
            pending_space: false,
        }
    }

    fn base_prefix(&self) -> String {
        let mut prefix = "  ".repeat(self.lists.len().saturating_sub(1));
        for _ in 0..self.quote_depth {
            prefix.push_str("│ ");
        }
        prefix
    }

    fn begin_block(&mut self, extra: &str) {
        if !self.line.is_empty() {
            self.finish_line();
        }
        let base = self.base_prefix();
        self.first_prefix = format!("{base}{extra}");
        self.continuation_prefix = format!("{base}{}", " ".repeat(extra.width()));
        self.prefix_written = false;
    }

    fn ensure_prefix(&mut self) {
        if self.prefix_written {
            return;
        }
        let prefix = self.first_prefix.clone();
        if !prefix.is_empty() {
            self.line.push_str(DIM);
            self.line.push_str(&prefix);
            self.line.push_str(RESET);
            self.visible += prefix.width();
        }
        self.prefix_written = true;
    }

    fn style(&self) -> InlineStyle {
        if self.heading.is_some() {
            InlineStyle::Heading
        } else if self.quote_depth > 0 && self.styles.len() == 1 {
            InlineStyle::Quote
        } else {
            *self.styles.last().unwrap_or(&InlineStyle::Normal)
        }
    }

    fn write_piece(&mut self, piece: &str, style: InlineStyle) {
        if piece.is_empty() {
            return;
        }
        self.ensure_prefix();
        self.line.push_str(style.ansi());
        self.line.push_str(piece);
        self.line.push_str(RESET);
        self.visible += piece.width();
    }

    fn write_char_wrapped(&mut self, ch: char, style: InlineStyle) {
        let char_width = ch.width().unwrap_or(0);
        self.ensure_prefix();
        if self.visible + char_width > self.width && self.visible > self.first_prefix.width() {
            self.wrap_line();
        }
        let mut buf = [0; 4];
        self.write_piece(ch.encode_utf8(&mut buf), style);
    }

    fn write_word(&mut self, word: &str, style: InlineStyle, pending_space: bool) {
        let word_width = word.width();
        self.ensure_prefix();
        let space_width = usize::from(pending_space && self.visible > self.first_prefix.width());

        if self.visible + space_width + word_width > self.width
            && self.visible > self.first_prefix.width()
        {
            self.wrap_line();
        } else if space_width == 1 {
            self.write_piece(" ", style);
        }

        if word_width <= self.width.saturating_sub(self.visible) {
            self.write_piece(word, style);
        } else {
            for ch in word.chars() {
                self.write_char_wrapped(ch, style);
            }
        }
        self.pending_space = false;
    }

    fn write_text(&mut self, text: &str, style: InlineStyle) {
        let mut word = String::new();

        for ch in text.chars() {
            match ch {
                '\n' => {
                    if !word.is_empty() {
                        self.write_word(&word, style, self.pending_space);
                        word.clear();
                    }
                    self.finish_line();
                    self.pending_space = false;
                }
                c if c.is_whitespace() => {
                    if !word.is_empty() {
                        self.write_word(&word, style, self.pending_space);
                        word.clear();
                    }
                    self.pending_space = true;
                }
                _ => word.push(ch),
            }
        }

        if !word.is_empty() {
            self.write_word(&word, style, self.pending_space);
        }
    }

    fn wrap_line(&mut self) {
        self.finish_line();
        self.first_prefix = self.continuation_prefix.clone();
    }

    fn finish_line(&mut self) {
        self.ensure_prefix();
        self.line.push_str(RESET);
        self.lines.push(std::mem::take(&mut self.line));
        self.visible = 0;
        self.pending_space = false;
        self.first_prefix = self.continuation_prefix.clone();
        self.prefix_written = false;
    }

    fn blank_line(&mut self) {
        if !self.line.is_empty() {
            self.finish_line();
        }
        if self.lines.last().is_some_and(|line| !line.is_empty()) {
            self.lines.push(String::new());
        }
    }

    fn horizontal_rule(&mut self) {
        self.begin_block("");
        let rule = "─".repeat(self.width.min(88));
        self.write_piece(&rule, InlineStyle::Dim);
        self.finish_line();
        self.blank_line();
    }

    fn start_item(&mut self) {
        let marker = if let Some(list) = self.lists.last_mut() {
            match list.next {
                Some(number) => {
                    list.next = Some(number + 1);
                    format!("{number}. ")
                }
                None => "• ".to_string(),
            }
        } else {
            "• ".to_string()
        };
        self.begin_block(&marker);
    }

    fn finish(mut self) -> String {
        if !self.line.is_empty() {
            self.finish_line();
        }
        while self.lines.last().is_some_and(String::is_empty) {
            self.lines.pop();
        }
        self.lines.join("\n")
    }
}

fn render(input: &str, width: usize) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS;
    let parser = Parser::new_ext(input, options);
    let mut out = Renderer::new(width);

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Paragraph => {
                    if out.line.is_empty() && !out.prefix_written {
                        out.begin_block("");
                    }
                }
                Tag::Heading(level, _, _) => {
                    out.blank_line();
                    out.heading = Some(level);
                    let marker = match level {
                        HeadingLevel::H1 => "██ ",
                        HeadingLevel::H2 => "▓ ",
                        HeadingLevel::H3 => "▒ ",
                        _ => "▸ ",
                    };
                    out.begin_block(marker);
                }
                Tag::BlockQuote => {
                    out.blank_line();
                    out.quote_depth += 1;
                    out.begin_block("");
                }
                Tag::CodeBlock(kind) => {
                    out.blank_line();
                    out.code_block = true;
                    out.begin_block("  ");
                    if let CodeBlockKind::Fenced(language) = kind {
                        if !language.is_empty() {
                            out.write_text(&format!("[{language}]"), InlineStyle::Dim);
                            out.finish_line();
                        }
                    }
                }
                Tag::List(start) => out.lists.push(ListState { next: start }),
                Tag::Item => out.start_item(),
                Tag::Emphasis => out.styles.push(InlineStyle::Emphasis),
                Tag::Strong => out.styles.push(InlineStyle::Strong),
                Tag::Strikethrough => out.styles.push(InlineStyle::Strike),
                Tag::Link(_, destination, _) => {
                    out.link_target = Some(destination.into_string());
                    out.styles.push(InlineStyle::Link);
                }
                Tag::Image(_, destination, _) => {
                    out.image_target = Some(destination.into_string());
                    out.write_text("[image: ", InlineStyle::Dim);
                }
                Tag::FootnoteDefinition(name) => {
                    out.blank_line();
                    out.begin_block(&format!("[^{name}] "));
                }
                Tag::Table(_) => {
                    out.blank_line();
                    out.table = true;
                    out.begin_block("│ ");
                }
                Tag::TableHead => out.table_head = true,
                Tag::TableRow => out.begin_block("│ "),
                Tag::TableCell => {}
            },
            Event::End(tag) => match tag {
                Tag::Paragraph => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                    if out.lists.is_empty() && !out.table {
                        out.blank_line();
                    }
                }
                Tag::Heading(_, _, _) => {
                    out.finish_line();
                    out.heading = None;
                    out.blank_line();
                }
                Tag::BlockQuote => {
                    if !out.line.is_empty() {
                        out.finish_line();
                    }
                    out.quote_depth = out.quote_depth.saturating_sub(1);
                    out.blank_line();
                }
                Tag::CodeBlock(_) => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                    out.code_block = false;
                    out.blank_line();
                }
                Tag::List(_) => {
                    out.lists.pop();
                    if out.lists.is_empty() {
                        out.blank_line();
                    }
                }
                Tag::Item => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                }
                Tag::Emphasis | Tag::Strong | Tag::Strikethrough => {
                    if out.styles.len() > 1 {
                        out.styles.pop();
                    }
                }
                Tag::Link(_, _, _) => {
                    if out.styles.len() > 1 {
                        out.styles.pop();
                    }
                    if let Some(target) = out.link_target.take() {
                        out.write_text(&format!(" <{target}>"), InlineStyle::Dim);
                    }
                }
                Tag::Image(_, _, _) => {
                    if let Some(target) = out.image_target.take() {
                        out.write_text(&format!("] <{target}>"), InlineStyle::Dim);
                    }
                }
                Tag::FootnoteDefinition(_) => out.blank_line(),
                Tag::Table(_) => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                    out.table = false;
                    out.blank_line();
                }
                Tag::TableHead => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                    out.table_head = false;
                    let rule_width = out.width.saturating_sub(2).min(88);
                    out.begin_block("├ ");
                    out.write_piece(&"─".repeat(rule_width), InlineStyle::Dim);
                    out.finish_line();
                }
                Tag::TableRow => {
                    if !out.line.is_empty() || out.prefix_written {
                        out.finish_line();
                    }
                }
                Tag::TableCell => out.write_text(" │ ", InlineStyle::Dim),
            },
            Event::Text(text) => {
                let style = if out.code_block {
                    InlineStyle::Code
                } else if out.table_head {
                    InlineStyle::Strong
                } else {
                    out.style()
                };
                out.write_text(&text, style);
            }
            Event::Code(code) => out.write_text(&format!("`{code}`"), InlineStyle::Code),
            Event::Html(html) => out.write_text(&html, InlineStyle::Dim),
            Event::FootnoteReference(name) => {
                out.write_text(&format!("[^{name}]"), InlineStyle::Link)
            }
            Event::SoftBreak => out.write_text(" ", out.style()),
            Event::HardBreak => out.finish_line(),
            Event::Rule => out.horizontal_rule(),
            Event::TaskListMarker(checked) => {
                out.write_text(if checked { "☑ " } else { "☐ " }, InlineStyle::Quote)
            }
        }
    }

    out.finish()
}

#[no_mangle]
pub extern "C" fn alloc(length: u32) -> u32 {
    let mut bytes = Vec::<u8>::with_capacity(length as usize);
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    pointer as u32
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: u32, length: u32) {
    drop(Vec::from_raw_parts(
        pointer as *mut u8,
        length as usize,
        length as usize,
    ));
}

#[no_mangle]
pub unsafe extern "C" fn render_markdown(pointer: u32, length: u32, width: u32) {
    let input = slice::from_raw_parts(pointer as *const u8, length as usize);
    let markdown = String::from_utf8_lossy(input);
    let rendered = render(&markdown, width as usize);
    RESULT.with(|result| *result.borrow_mut() = rendered.into_bytes());
}

#[no_mangle]
pub extern "C" fn result_pointer() -> u32 {
    RESULT.with(|result| result.borrow().as_ptr() as u32)
}

#[no_mangle]
pub extern "C" fn result_length() -> u32 {
    RESULT.with(|result| result.borrow().len() as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain(input: &str) -> String {
        let rendered = render(input, 24);
        let mut output = String::new();
        let mut in_escape = false;
        for ch in rendered.chars() {
            if ch == '\x1b' {
                in_escape = true;
            } else if in_escape && ch == 'm' {
                in_escape = false;
            } else if !in_escape {
                output.push(ch);
            }
        }
        output
    }

    #[test]
    fn renders_headings_and_emphasis() {
        let output = plain("# NeuroMD\n\nThis is **alive**.");
        assert!(output.contains("██ NeuroMD"));
        assert!(output.contains("This is alive."));
    }

    #[test]
    fn renders_lists_and_tasks() {
        let output = plain("- one\n- [x] two\n\n1. three");
        assert!(output.contains("• one"));
        assert!(output.contains("☑ two"));
        assert!(output.contains("1. three"));
    }

    #[test]
    fn wraps_long_lines() {
        let output = plain("alpha beta gamma delta epsilon zeta eta theta iota kappa");
        assert!(output.lines().count() > 1);
    }
}
