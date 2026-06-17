#!/usr/bin/env ruby
# frozen_string_literal: true

require "cgi"
require "json"
require "fileutils"

DASH = "\u2014" # em dash used in export for empty fields

html_path = ARGV[0] || File.expand_path("../tmp-ploid-people.html", __dir__)
out_path = ARGV[1] || File.expand_path("../data/ploid-people.json", __dir__)

html = File.read(html_path, encoding: "UTF-8")
tbody = html[/ <tbody[^>]*>(.*?)<\/tbody>/m, 1] || html[/tbody[^>]*>(.*?)<\/tbody>/m, 1]
abort("No tbody found") unless tbody

contacts = tbody.scan(/<tr[^>]*>(.*?)<\/tr>/m).map do |row|
  cells = row[0].scan(/<td[^>]*>(.*?)<\/td>/m).map do |c|
    CGI.unescapeHTML(c[0].gsub(/<[^>]+>/, " ").gsub(/\s+/, " ").strip)
  end
  next if cells.size < 4

  email = cells[3]
  email = "" if email.empty? || email == DASH || email == "-"
  tags = cells[4].to_s
  notes = []
  notes << "Title: #{cells[1]}" unless cells[1].to_s.empty? || cells[1] == DASH
  notes << "Tags: #{tags}" unless tags.empty? || tags == DASH

  {
    "name" => cells[0],
    "title" => cells[1],
    "company" => (cells[2] == DASH ? "" : cells[2]),
    "email" => email,
    "tags" => (tags == DASH ? "" : tags),
    "notes" => notes.join("\n"),
  }
end.compact

FileUtils.mkdir_p(File.dirname(out_path))
File.write(out_path, JSON.pretty_generate(contacts))

companies = contacts.map { |c| c["company"] }.reject(&:empty?).uniq
puts "Parsed #{contacts.size} contacts"
puts "Unique companies: #{companies.size}"
puts "With email: #{contacts.count { |c| !c['email'].empty? }}"
puts "Wrote #{out_path}"
