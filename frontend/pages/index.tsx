"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

// Enhanced types for new API responses
type FilesResponse = string[];
type SearchResponse = { filename?: string; text?: string; score?: number; source_type?: number };
type QaResponse = { source_file?: string; answer?: string };
type EmbedResponse = { filename: string; status: string; chunks?: number }[];

// New enhanced types
type EnhancedQaResponse = {
  answer: string;
  confidence: number;
  missing_info: string[];
  source_files: string[];
  enrichment_suggestions: EnrichmentSuggestion[];
  relevance_score: number;
};

type EnrichmentSuggestion = {
  type: string;
  priority: number;
  description: string;
  action: string;
  estimated_improvement: string;
  search_query?: string;
  missing_topics?: string[];
};

type AutoEnrichmentResponse = {
  enriched_sources: number;
  content: Array<{
    source: string;
    topic: string;
    content: string;
    url?: string;
  }>;
  status: string;
};

type FeedbackStats = {
  total_feedback: number;
  average_rating: number;
  rating_distribution: Record<number, number>;
};

export default function Home() {
  // Existing state
  const [files, setFiles] = useState<FileList | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [qaQuery, setQaQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [qaResult, setQaResult] = useState<QaResponse | null>(null);
  const [embedResult, setEmbedResult] = useState<EmbedResponse | null>(null);

  // New enhanced state
  const [enhancedQaResult, setEnhancedQaResult] = useState<EnhancedQaResponse | null>(null);
  const [autoEnrichmentResult, setAutoEnrichmentResult] = useState<AutoEnrichmentResponse | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<FeedbackStats | null>(null);
  const [selectedRating, setSelectedRating] = useState<number>(5);
  const [feedbackText, setFeedbackText] = useState("");
  const [activeTab, setActiveTab] = useState<"basic" | "enhanced">("enhanced");
  const [enableAutoEnrichment, setEnableAutoEnrichment] = useState(true);

  const [loading, setLoading] = useState<{
    upload?: boolean;
    embed?: boolean;
    search?: boolean;
    qa?: boolean;
    enhancedQa?: boolean;
    autoEnrich?: boolean;
    feedback?: boolean;
    fetchFiles?: boolean;
    feedbackStats?: boolean;
  }>({});

  const backend = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

  // Fetch files and stats on component mount
  useEffect(() => {
    fetchFiles();
    fetchFeedbackStats();
  }, []);

  // Existing functions (updated endpoints)
  const handleUpload = async () => {
    if (!files) return;
    setLoading((s) => ({ ...s, upload: true }));
    let successCount = 0;
    let errorCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append("file", files[i]);

        try {
          const res = await fetch(`${backend}/upload/`, {
            method: "POST",
            body: formData
          });

          if (!res.ok) {
            const errorText = await res.text();
            console.error(`Upload failed for ${files[i].name}: ${res.status} - ${errorText}`);
            errorCount++;
          } else {
            successCount++;
          }
        } catch (fileError) {
          console.error(`Upload error for ${files[i].name}:`, fileError);
          errorCount++;
        }
      }

      if (successCount > 0) {
        await fetchFiles();
      }

      if (errorCount > 0) {
        alert(`Upload completed with ${successCount} successes and ${errorCount} failures. Check console for details.`);
      } else {
        alert(`Successfully uploaded ${successCount} files!`);
      }

      setFiles(null);
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (fileInput) fileInput.value = '';

    } catch (e) {
      console.error("Upload error:", e);
      alert("Upload failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, upload: false }));
    }
  };

  const fetchFiles = async () => {
    setLoading((s) => ({ ...s, fetchFiles: true }));
    try {
      const res = await fetch(`${backend}/files/`);
      if (!res.ok) {
        throw new Error(`Failed to fetch files: ${res.status}`);
      }
      const data: FilesResponse = await res.json();
      setUploaded(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Fetch files error:", e);
      setUploaded([]);
    } finally {
      setLoading((s) => ({ ...s, fetchFiles: false }));
    }
  };

  const embedFiles = async () => {
    if (!uploaded.length) return;
    setLoading((s) => ({ ...s, embed: true }));
    setEmbedResult(null);

    try {
      const res = await fetch(`${backend}/embed/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uploaded),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Embed failed: ${res.status} - ${errorText}`);
      }

      const data: EmbedResponse = await res.json();
      setEmbedResult(data);

      const successCount = data.filter(r => r.status === "Embedded" || r.status === "Already embedded").length;
      const errorCount = data.length - successCount;

      if (errorCount > 0) {
        alert(`Embedding completed with ${successCount} successes and ${errorCount} issues.`);
      }
    } catch (e) {
      console.error("Embed error:", e);
      alert("Embed failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, embed: false }));
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading((s) => ({ ...s, search: true }));
    setSearchResult(null);

    try {
      const res = await fetch(`${backend}/search?query=${query.trim()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!res.ok) {
        if (res.status === 404) {
          setSearchResult(null);
          alert("No results found for your query.");
          return;
        }
        const errorText = await res.text();
        throw new Error(`Search failed: ${res.status} - ${errorText}`);
      }

      const data: SearchResponse = await res.json();
      console.log(data);
      setSearchResult(data);
    } catch (e) {
      console.error("Search error:", e);
      setSearchResult(null);
      alert("Search failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, search: false }));
    }
  };

  // Legacy Q&A
  const handleQa = async () => {
    if (!qaQuery.trim()) return;
    setLoading((s) => ({ ...s, qa: true }));
    setQaResult(null);

    try {
      const res = await fetch(`${backend}/qa?query=${query.trim()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!res.ok) {
        if (res.status === 404) {
          setQaResult(null);
          alert("No relevant document found for your question.");
          return;
        }
        const errorText = await res.text();
        throw new Error(`QA failed: ${res.status} - ${errorText}`);
      }

      const data: QaResponse = await res.json();
      setQaResult(data);
    } catch (e) {
      console.error("QA error:", e);
      setQaResult(null);
      alert("Question answering failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, qa: false }));
    }
  };

  // Enhanced Q&A
  const handleEnhancedQa = async () => {
    if (!qaQuery.trim()) return;
    setLoading((s) => ({ ...s, enhancedQa: true }));
    setEnhancedQaResult(null);

    try {
      const url = new URL(`${backend}/qa/enhanced/`);
      url.searchParams.append('query', qaQuery.trim());
      url.searchParams.append('enable_auto_enrichment', enableAutoEnrichment.toString());

      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Enhanced QA failed: ${res.status} - ${errorText}`);
      }

      const data: EnhancedQaResponse = await res.json();
      setEnhancedQaResult(data);
    } catch (e) {
      console.error("Enhanced QA error:", e);
      alert("Enhanced question answering failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, enhancedQa: false }));
    }
  };

  // Auto-enrichment
  const handleAutoEnrichment = async (missingInfo: string[]) => {
    if (!missingInfo.length) return;
    setLoading((s) => ({ ...s, autoEnrich: true }));

    try {
      const res = await fetch(`${backend}/enrich/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: qaQuery.trim(),
          missing_info: missingInfo,
          max_sources: 3
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Auto-enrichment failed: ${res.status} - ${errorText}`);
      }

      const data: AutoEnrichmentResponse = await res.json();
      setAutoEnrichmentResult(data);

      // Re-run enhanced QA to get updated results
      if (data.enriched_sources > 0) {
        setTimeout(() => handleEnhancedQa(), 1000);
      }
    } catch (e) {
      console.error("Auto-enrichment error:", e);
      alert("Auto-enrichment failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, autoEnrich: false }));
    }
  };

  // Feedback submission
  const handleFeedbackSubmission = async () => {
    if (!enhancedQaResult) return;

    setLoading((s) => ({ ...s, feedback: true }));

    try {
      const res = await fetch(`${backend}/feedback/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: qaQuery,
          answer: enhancedQaResult.answer,
          rating: selectedRating,
          feedback_text: feedbackText || undefined
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Feedback submission failed: ${res.status} - ${errorText}`);
      }

      alert("Thank you for your feedback!");
      setFeedbackText("");
      setSelectedRating(5);
      fetchFeedbackStats(); // Refresh stats
    } catch (e) {
      console.error("Feedback error:", e);
      alert("Feedback submission failed. Check console for details.");
    } finally {
      setLoading((s) => ({ ...s, feedback: false }));
    }
  };

  // Fetch feedback stats
  const fetchFeedbackStats = async () => {
    setLoading((s) => ({ ...s, feedbackStats: true }));
    try {
      const res = await fetch(`${backend}/feedback/stats/`);
      if (!res.ok) {
        throw new Error(`Failed to fetch feedback stats: ${res.status}`);
      }
      const data: FeedbackStats = await res.json();
      setFeedbackStats(data);
    } catch (e) {
      console.error("Feedback stats error:", e);
    } finally {
      setLoading((s) => ({ ...s, feedbackStats: false }));
    }
  };

  // Helper functions
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.6) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.6) return "Medium";
    return "Low";
  };

  // Event handlers
  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading.search) {
      handleSearch();
    }
  };

  const handleQaKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading.qa && !loading.enhancedQa) {
      if (activeTab === "enhanced") {
        handleEnhancedQa();
      } else {
        handleQa();
      }
    }
  };

  return (
    <main className="min-h-screen bg-stone-800 dark:bg-stone-900 text-gray-900 dark:text-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-amber-400 bg-clip-text">
            wand.ai assignment
          </h1>
        </div>

        {/* System Stats */}
        {feedbackStats && (
          <section className="bg-stone-900 dark:from-blue-900/20 dark:to-purple-900/20 p-6 rounded-2xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              Past ratings
              <button
                onClick={fetchFeedbackStats}
                disabled={loading.feedbackStats}
                className="ml-auto px-3 py-1 text-sm bg-stone-600 text-white rounded-lg hover:bg-stone-700 disabled:opacity-50"
              >
                {loading.feedbackStats ? "..." : "Refresh"}
              </button>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-stone-800 p-4 rounded-lg">
                <div className="text-2xl font-bold text-amber-600">{feedbackStats.total_feedback}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Total Feedback</div>
              </div>
              <div className="bg-white dark:bg-stone-800 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {feedbackStats.average_rating.toFixed(1)}/5
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Average Rating</div>
              </div>
              <div className="bg-white dark:bg-stone-800 p-4 rounded-lg">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(star => (
                    <div key={star} className="text-xs">
                      ⭐{feedbackStats.rating_distribution[star] || 0}
                    </div>
                  ))}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Rating Distribution</div>
              </div>
            </div>
          </section>
        )}

        {/* Upload */}
        <section className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-md">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            Upload Documents
          </h2>
          <div className="flex items-center gap-4">
            <input
              type="file"
              multiple
              accept=".pdf"
              onChange={(e) => setFiles(e.target.files)}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0
                         file:bg-stone-700 file:hover:bg-stone-800
                         file:text-amber-400
                         file:text-sm file:font-semibold"
            />
            <button
              onClick={handleUpload}
              disabled={!files || loading.upload}
              className="px-6 py-2 bg-stone-700 text-amber-400 rounded-lg hover:bg-stone-800
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading.upload ? "Uploading..." : "Upload"}
            </button>
          </div>
          {files && (
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Selected: {files.length} file{files.length !== 1 ? 's' : ''}
            </p>
          )}
        </section>

        {/* Files & Embedding */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Files ({uploaded.length})</h2>
              <button
                onClick={fetchFiles}
                disabled={loading.fetchFiles}
                className="px-3 py-1 bg-gray-600 text-white rounded-lg hover:bg-gray-700
                           disabled:opacity-50 transition-colors"
              >
                {loading.fetchFiles ? "..." : "Refresh"}
              </button>
            </div>
            {uploaded.length > 0 ? (
              <ul className="list-disc pl-6 space-y-1 max-h-40 overflow-y-auto">
                {uploaded.map((f) => (
                  <li key={f} className="text-sm text-gray-700 dark:text-gray-300">{f}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No files uploaded yet.</p>
            )}
          </section>

          <section className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-md">
            <h2 className="text-xl font-semibold mb-4">Embed Files</h2>
            <button
              onClick={embedFiles}
              disabled={!uploaded.length || loading.embed}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading.embed ? "Processing..." : `Embed All (${uploaded.length})`}
            </button>

            {embedResult && (
              <div className="mt-4 space-y-2 max-h-48 overflow-y-auto">
                <h3 className="font-medium">Results:</h3>
                {embedResult.map((result, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700 text-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-medium truncate">{result.filename}</span>
                      <span className={`px-2 py-1 rounded text-xs ml-2 ${
                        result.status === "Embedded" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" :
                        result.status === "Already embedded" ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" :
                        "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                      }`}>
                        {result.status}
                      </span>
                    </div>
                    {result.chunks && (
                      <p className="text-gray-600 dark:text-gray-400 mt-1">
                        Chunks: {result.chunks}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Search */}
        <section className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-md">
          <h2 className="text-xl font-semibold mb-4">Document Search</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleSearchKeyPress}
              placeholder="Enter search query..."
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            />
            <button
              onClick={handleSearch}
              disabled={!query.trim() || loading.search}
              className="px-6 py-2 bg-stone-700 text-white rounded-lg hover:bg-stone-800
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading.search ? "Searching..." : "Search"}
            </button>
          </div>

          {searchResult && (
            <div className="mt-4 p-4 rounded-lg
                            bg-stone-800 dark:bg-stone-800">
              <p><span className="font-semibold">File:</span> {searchResult.filename ?? "—"}</p>
              <p className="mt-2"><span className="font-semibold">Content:</span></p>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap
                         bg-white dark:bg-stone-800 p-3 rounded">
                {searchResult.text ?? "—"}
              </p>
              {typeof searchResult.score === "number" && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  Similarity Score: {searchResult.score.toFixed(4)}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Enhanced Q&A */}
        <section className="bg-white dark:bg-stone-900 p-6 rounded-2xl shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">AI Question Answering</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("basic")}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === "basic"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                Basic
              </button>
              <button
                onClick={() => setActiveTab("enhanced")}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  activeTab === "enhanced"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                }`}
              >
                Enhanced
              </button>
            </div>
          </div>

          {activeTab === "enhanced" && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enableAutoEnrichment}
                  onChange={(e) => setEnableAutoEnrichment(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-sm">Enable Auto-Enrichment (fetch external data when needed)</span>
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={qaQuery}
              onChange={(e) => setQaQuery(e.target.value)}
              onKeyPress={handleQaKeyPress}
              placeholder="Ask a question about your documents..."
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2
                         bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-red-500 focus:border-transparent"
            />
            <button
              onClick={activeTab === "enhanced" ? handleEnhancedQa : handleQa}
              disabled={!qaQuery.trim() || loading.qa || loading.enhancedQa}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {(loading.qa || loading.enhancedQa) ? "Processing..." : "Ask"}
            </button>
          </div>

          {/* Basic Q&A Results */}
          {activeTab === "basic" && qaResult && (
            <div className="mt-4 p-4 rounded-lg
                            bg-stone-800 dark:bg-stone-800">
              <p><span className="font-semibold">Source:</span> {qaResult.source_file ?? "—"}</p>
              <p className="mt-2"><span className="font-semibold">Answer:</span></p>
              <div className="mt-1 text-sm bg-white dark:bg-stone-800 p-4 rounded
                              prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{qaResult.answer ?? "—"}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Enhanced Q&A Results */}
          {activeTab === "enhanced" && enhancedQaResult && (
            <div className="mt-4 space-y-4">
              {/* Main Answer */}
              <div className="p-4 rounded-lg
                              bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="font-semibold text-lg">Enhanced Answer</h3>
                  <div className="flex items-center gap-4">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getConfidenceColor(enhancedQaResult.confidence)}`}>
                      Confidence: {getConfidenceLabel(enhancedQaResult.confidence)} ({(enhancedQaResult.confidence * 100).toFixed(1)}%)
                    </span>
                    <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm">
                      Relevance: {(enhancedQaResult.relevance_score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="bg-white dark:bg-stone-800 p-4 rounded-lg">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{enhancedQaResult.answer}</ReactMarkdown>
                  </div>
                </div>

                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">Sources:</span> {[...(new Set(enhancedQaResult.source_files))].join(" • ")}
                </div>
              </div>

              {/* Missing Information Alert */}
              {enhancedQaResult.missing_info.length > 0 && (
                <div className="p-4 rounded-lg
                                bg-orange-50 dark:bg-orange-900/20">
                  <h4 className="font-medium text-orange-800 dark:text-orange-200 mb-2">
                    Missing Information Detected
                  </h4>
                  <ul className="list-disc pl-5 text-sm text-orange-700 dark:text-orange-300 mb-3">
                    {enhancedQaResult.missing_info.map((info, idx) => (
                      <li key={idx}>{info}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => handleAutoEnrichment(enhancedQaResult.missing_info)}
                    disabled={loading.autoEnrich}
                    className="px-4 py-2 bg-stone-600 text-white rounded-lg hover:bg-stone-700
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {loading.autoEnrich ? "Enriching..." : "Auto-Enrich from External Sources"}
                  </button>
                </div>
              )}

              {/* Auto-Enrichment Results */}
              {autoEnrichmentResult && (
                <div className="p-4 border border-green-200 dark:border-green-800 rounded-lg
                                bg-green-50 dark:bg-green-900/20">
                  <h4 className="font-medium text-green-800 dark:text-green-200 mb-2">
                    ✅ Auto-Enrichment Results
                  </h4>
                  {autoEnrichmentResult.status === "success" ? (
                    <div className="space-y-3">
                      <p className="text-sm text-green-700 dark:text-green-300">
                        Successfully enriched with {autoEnrichmentResult.enriched_sources} external sources:
                      </p>
                      {autoEnrichmentResult.content.map((source, idx) => (
                        <div key={idx} className="bg-white dark:bg-gray-800 p-3 rounded border">
                          <div className="flex justify-between items-start mb-2">
                            <span className="font-medium text-sm">{source.source}: {source.topic}</span>
                            {source.url && (
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                View Source
                              </a>
                            )}
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                            {source.content.substring(0, 200)}...
                          </p>
                        </div>
                      ))}
                      <p className="text-xs text-green-600 dark:text-green-400 italic">
                        💡 Re-run your question to get an enhanced answer with this new information!
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      No additional sources found for the missing information.
                    </p>
                  )}
                </div>
              )}

              {/* Enrichment Suggestions */}
              {enhancedQaResult.enrichment_suggestions.length > 0 && (
                <div className="p-4 rounded-lg
                                bg-stone-800 dark:bg-stone-800">
                  <h4 className="font-medium text-stone-400 dark:text-stone-200 mb-3">
                    Improvement Suggestions
                  </h4>
                  <div className="space-y-3">
                    {enhancedQaResult.enrichment_suggestions
                      .sort((a, b) => a.priority - b.priority)
                      .map((suggestion, idx) => (
                      <div key={idx} className="bg-white dark:bg-stone-700 p-3 rounded">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              suggestion.priority === 1 ? "bg-red-100 text-red-700 dark:bg-red-800 dark:text-yellow-200" :
                              suggestion.priority === 2 ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" :
                              "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                            }`}>
                              Priority {suggestion.priority}
                            </span>
                            <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                              {suggestion.type.replace('_', ' ')}
                            </span>
                          </div>
                          <span className="px-2 py-1 bg-stone-900 dark:bg-stone-900 text-purple-500 dark:text-purple-200 rounded text-xs">
                            {suggestion.estimated_improvement} Impact
                          </span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                          {suggestion.description}
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          {suggestion.action}
                        </p>
                        {suggestion.search_query && (
                          <button
                            onClick={() => handleAutoEnrichment([suggestion.search_query!])}
                            disabled={loading.autoEnrich}
                            className="mt-2 px-3 py-1 bg-stone-800 text-white rounded text-xs hover:bg-stone-900
                                       disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Auto-Enrich: {suggestion.search_query}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback Section */}
              <div className="p-4 rounded-lg
                              bg-stone-800 dark:bg-stone-800">
                <h4 className="font-medium mb-3">Rate This Answer</h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Rating:</span>
                    {[1, 2, 3, 4, 5].map(rating => (
                      <button
                        key={rating}
                        onClick={() => setSelectedRating(rating)}
                        className={`px-3 py-1 rounded text-sm transition-colors ${
                          selectedRating === rating
                            ? "bg-yellow-700 text-white"
                            : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
                        }`}
                      >
                        {rating} ⭐
                      </button>
                    ))}
                  </div>
                  <div>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Optional: Provide specific feedback about the answer quality..."
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm
                                 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                                 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      rows={2}
                    />
                  </div>
                  <button
                    onClick={handleFeedbackSubmission}
                    disabled={loading.feedback}
                    className="px-4 py-2 bg-green-800 text-white rounded-lg hover:bg-green-700
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    {loading.feedback ? "Submitting..." : "Submit Feedback"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
