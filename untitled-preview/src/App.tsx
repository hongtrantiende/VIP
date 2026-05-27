import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import React, { useState, useEffect, createContext, useContext } from 'react';
import { Search as SearchIcon, BookOpen, ChevronLeft, ChevronRight, ArrowLeft, Download } from 'lucide-react';
import axios from 'axios';

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-12 text-center">
          <h2 className="text-xl text-red-600 mb-4 font-bold">Đã xảy ra lỗi hiển thị (Crash)!</h2>
          <pre className="text-sm text-left bg-gray-100 p-4 overflow-auto">{this.state.error?.toString()}</pre>
          <button onClick={() => window.location.href='/'} className="mt-4 px-4 py-2 bg-[#8B5E3C] text-white">Về trang chủ</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const api = axios.create({ baseURL: '/api' });

const SourceContext = createContext({ source: 'truyenfull', setSource: (s: string) => {} });

const Navbar = () => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { source, setSource } = useContext(SourceContext);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-[#F4F1EA] border-b border-[#E5E1D8] shadow-sm">
      <div className="max-w-5xl mx-auto px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0 self-start sm:self-center">
          <BookOpen className="w-6 h-6 text-[#8B5E3C]" />
          <span className="font-serif font-black text-xl tracking-tight text-[#2D2D2D]">Novel<span className="text-[#8B5E3C]">Hub</span></span>
        </Link>
        <div className="flex gap-2 text-xs font-bold uppercase tracking-widest bg-[#EDE9E0] p-1 rounded-sm border border-[#DED9CE] w-full sm:w-auto overflow-x-auto">
           <button onClick={() => setSource('truyenfull')} className={`px-4 py-2 whitespace-nowrap transition-colors ${source === 'truyenfull' ? 'bg-[#8B5E3C] text-white shadow-sm' : 'text-[#8B5E3C] hover:bg-[#F4F1EA]'}`}>
              Truyện Full
           </button>
           <button onClick={() => setSource('wikidich')} className={`px-4 py-2 whitespace-nowrap transition-colors ${source === 'wikidich' ? 'bg-[#8B5E3C] text-white shadow-sm' : 'text-[#8B5E3C] hover:bg-[#F4F1EA]'}`}>
              Wiki Dịch
           </button>
        </div>
        <form onSubmit={handleSearch} className="w-full sm:flex-1 max-w-md relative">
          <div className="relative border border-[#DED9CE] rounded-sm overflow-hidden focus-within:border-[#8B5E3C] transition-colors bg-[#EDE9E0] focus-within:bg-[#F9F7F2]">
             <input 
               type="text" 
               placeholder="Tìm kiếm truyện..." 
               className="w-full bg-transparent py-2 pl-10 pr-4 text-sm outline-none font-serif text-[#2D2D2D] placeholder:font-sans placeholder:text-[#A0998E]"
               value={query}
               onChange={(e) => setQuery(e.target.value)}
             />
             <SearchIcon className="w-4 h-4 text-[#8B5E3C] absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </form>
      </div>
    </nav>
  );
};

const Loading = () => (
   <div className="flex flex-col justify-center items-center h-48 space-y-4 w-full">
      <div className="w-8 h-8 rounded-full border-2 border-[#DED9CE] border-t-[#8B5E3C] animate-spin"></div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[#8B5E3C] font-bold">Đang tải...</div>
   </div>
);

const StoryCard = ({ title, img, slug }: { title: string, img?: string, slug: string }) => (
  <Link to={`/story/${slug}`} className="group flex flex-col gap-3">
    <div className="relative aspect-[2/3] overflow-hidden bg-[#E5E1D8] shadow-sm group-hover:shadow-[4px_4px_0px_#8B5E3C] transition-all rounded-sm border border-[#DED9CE]">
      {img ? (
        <img src={img} alt={title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 filter sepia-[0.1]" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[#A0998E]"><BookOpen className="w-8 h-8 opacity-50"/></div>
      )}
    </div>
    <h3 className="font-serif font-bold text-sm leading-tight text-[#2D2D2D] line-clamp-2 group-hover:text-[#8B5E3C] transition-colors" title={title}>{title}</h3>
  </Link>
);

const Home = () => {
  const { source } = useContext(SourceContext);
  const [data, setData] = useState<{hotStories: any[], newUpdates: any[]}>({ hotStories: [], newUpdates: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/home?source=${source}`).then(res => {
      setData(res.data);
    }).catch(err => {
      console.error(err);
      setData({ hotStories: [], newUpdates: [] });
    }).finally(() => setLoading(false));
  }, [source]);

  if (loading) return <Loading />;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-16">
      {data.hotStories.length === 0 && data.newUpdates.length === 0 ? (
        <div className="text-center text-[#8B5E3C] py-20 font-serif italic text-lg">
          Không thể tải dữ liệu từ {source === 'wikidich' ? 'Wiki Dịch' : 'Truyện Full'}. Có thể do lỗi mạng hoặc web bị lỗi/chặn.
        </div>
      ) : (
        <>
          {data.hotStories.length > 0 && (
          <section>
            <div className="flex flex-col items-center mb-10 text-center">
               <span className="font-serif italic text-lg text-[#8B5E3C]">Lựa chọn hàng đầu</span>
               <h2 className="text-4xl font-serif font-black mt-2 mb-4 tracking-tighter text-[#2D2D2D] truncate max-w-full">Truyện Phổ Biến tại {source === 'wikidich' ? 'Wiki Dịch' : 'Truyện Full'}</h2>
               <div className="h-px w-24 bg-[#DED9CE] mx-auto"></div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-10">
              {data.hotStories.map((s, idx) => (
                 <StoryCard key={idx} title={s.title} slug={s.slug} img={s.cover} />
              ))}
            </div>
          </section>
          )}

          {data.newUpdates.length > 0 && (
          <section>
            <div className="flex flex-col items-center mb-10 text-center">
               <span className="font-serif italic text-lg text-[#8B5E3C]">Mới nhất</span>
               <h2 className="text-4xl font-serif font-black mt-2 mb-4 tracking-tighter text-[#2D2D2D]">Vừa Cập Nhật</h2>
               <div className="h-px w-24 bg-[#DED9CE] mx-auto"></div>
            </div>
            <div className="bg-[#F4F1EA] border border-[#E5E1D8] p-6 shadow-inner rounded-sm">
              {data.newUpdates.map((s, idx) => (
                <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-[#E5E1D8] last:border-0 gap-3 group">
                   <div className="flex items-center gap-4">
                     <span className="text-[10px] font-bold text-[#A0998E] tracking-widest hidden sm:block w-6 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                     <Link to={`/story/${s.slug}`} className="font-serif font-black text-lg text-[#2D2D2D] group-hover:text-[#8B5E3C] transition-colors truncate block">{s.title}</Link>
                   </div>
                   <div className="flex items-center shrink-0">
                      <Link to={`/story/${s.slug}/${s.latestChapterSlug}`} className="text-xs uppercase tracking-widest text-[#8B5E3C] hover:text-[#2D2D2D] font-bold transition-colors">{s.latestChapter}</Link>
                   </div>
                </div>
              ))}
            </div>
            <div className="flex justify-center mt-10">
               <Link to={source === 'wikidich' ? "/list/chuong-moi" : "/list/truyen-moi"} className="inline-flex items-center gap-2 border border-[#8B5E3C] px-8 py-3 text-[#8B5E3C] text-[10px] uppercase font-bold tracking-[0.2em] hover:bg-[#8B5E3C] hover:text-white transition-colors">
                  XEM TẤT CẢ <ChevronRight className="w-4 h-4" />
               </Link>
            </div>
          </section>
          )}
        </>
      )}
    </div>
  );
};

const Search = () => {
  const { source } = useContext(SourceContext);
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!q) { setLoading(false); return; }
    setLoading(true);
    api.get(`/search?q=${encodeURIComponent(q)}&source=${source}`).then(res => {
      setResults(res.data.results || []);
    }).catch(() => {
      setResults([]);
    }).finally(() => setLoading(false));
  }, [q, source]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
       <div className="flex flex-col items-center mb-10 text-center">
         <span className="font-serif italic text-lg text-[#8B5E3C]">Kết quả cho: "{q}"</span>
         <h1 className="text-4xl font-serif font-black mt-2 mb-4 tracking-tighter text-[#2D2D2D]">Tìm Kiếm Truyện</h1>
         <div className="h-px w-24 bg-[#DED9CE] mx-auto"></div>
       </div>

       {loading ? <Loading /> : (
          <div className="bg-[#F4F1EA] border border-[#E5E1D8] shadow-inner p-6 rounded-sm">
             {results.length === 0 ? (
               <div className="p-12 text-center text-[#6B665E] font-serif italic">Không tìm thấy truyện nào.</div>
             ) : (
               results.map((r, i) => (
                 <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between py-5 border-b border-[#E5E1D8] last:border-0 gap-3 group transition-colors">
                    <Link to={`/story/${r.slug}`} className="font-serif font-black text-[#2D2D2D] group-hover:text-[#8B5E3C] text-xl transition-colors">{r.title}</Link>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm text-[#6B665E] font-serif italic">
                      <span className="sm:w-32">{r.author}</span>
                      <span className="sm:w-32 sm:text-right font-sans not-italic text-xs font-bold uppercase tracking-wider text-[#8B5E3C]">{r.latestChapter}</span>
                    </div>
                 </div>
               ))
             )}
          </div>
       )}
    </div>
  )
}

const StoryDetails = () => {
  const { source } = useContext(SourceContext);
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get('page') || '1');
  const [story, setStory] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    setLoading(true);
    api.get(`/story/${slug}?page=${page}&source=${source}`).then(res => {
       setStory(res.data);
    }).catch(() => {
       setStory({ error: true });
    }).finally(() => setLoading(false));
  }, [slug, page, source]);

  const handleDownloadStory = async () => {
      if (!story || !story.chapters || story.chapters.length === 0) return;
      setDownloading(true);
      setDownloadProgress(0);
      
      let content = `${story.title}\nTác giả: ${story.author}\n\n`;
      const chaptersToDownload = story.chapters;
      let successCount = 0;
      
      for (let i = 0; i < chaptersToDownload.length; i++) {
          const c = chaptersToDownload[i];
          setDownloadProgress(Math.round(((i) / chaptersToDownload.length) * 100));
          
          let success = false;
          let retries = 3;
          while (!success && retries > 0) {
              try {
                  const res = await api.get(`/chapter/${slug}/${encodeURIComponent(c.slug)}?source=${source}`);
                  if (res.data && res.data.content) {
                      const doc = new DOMParser().parseFromString(res.data.content, 'text/html');
                      const textContent = doc.body.textContent || '';
                      content += `\n\n--- ${c.title} ---\n\n`;
                      content += textContent.replace(/\n\s*\n/g, '\n\n');
                      successCount++;
                      success = true;
                  } else {
                      retries--;
                      if (retries > 0) await new Promise(r => setTimeout(r, 1000));
                  }
              } catch(e) {
                  retries--;
                  if (retries > 0) await new Promise(r => setTimeout(r, 1000));
              }
          }
          if (!success) {
              console.error('Failed to download chapter\n' + c.title);
              content += `\n\n--- ${c.title} ---\n\n[Lỗi: Không tải được nội dung chương này]\n\n`;
          }
          await new Promise(r => setTimeout(r, 500));
      }
      
      setDownloadProgress(100);
      setTimeout(() => setDownloading(false), 1000);
      
      if (successCount > 0) {
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${story.title} - p${page}.txt`;
          a.click();
          URL.revokeObjectURL(url);
      } else {
          alert("Không tải được chương nào!");
      }
  };

  if (loading) return <Loading />;
  if (!story || story.error || (!story.title && !story.desc)) return <div className="p-12 text-center text-[#8B5E3C] font-serif italic">Không tìm thấy truyện.</div>;

  return (
     <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="p-8 bg-[#F4F1EA] border border-[#E5E1D8] shadow-inner flex flex-col md:flex-row gap-10 mb-16 rounded-sm">
           <div className="w-40 md:w-56 shrink-0 md:mx-0 mx-auto">
             <div className="aspect-[2/3] bg-[#E5E1D8] shadow-[8px_8px_0px_#8B5E3C] border border-[#DED9CE] filter sepia-[0.1]">
                {story.cover ? 
                  <img src={story.cover} alt={story.title} className="w-full h-full object-cover" /> :
                  <div className="w-full h-full flex items-center justify-center text-[#A0998E]"><BookOpen className="w-12 h-12 opacity-50"/></div>
                }
             </div>
           </div>
           <div className="flex-1 flex flex-col justify-center text-center md:text-left">
              <div className="text-[10px] uppercase tracking-[0.2em] text-[#8B5E3C] font-bold mb-4 bg-[#EDE9E0] inline-block px-3 py-1 mx-auto md:mx-0 w-max border border-[#DED9CE] rounded-sm">Thông tin truyện</div>
              <h1 className="text-4xl md:text-5xl font-serif font-black tracking-tighter text-[#2D2D2D] mb-4">{story.title || 'Chưa rõ tên'}</h1>
              <p className="text-lg italic font-serif text-[#6B665E] mb-6">Tác giả: {story.author}</p>
              
              <div className="h-px w-full bg-[#E5E1D8] mb-6"></div>

              <div 
                className="text-[#3D3D3D] text-sm leading-relaxed max-h-48 overflow-y-auto pr-4 overscroll-contain prose prose-sm font-serif prose-p:mb-4 text-justify mb-6"
                dangerouslySetInnerHTML={{ __html: story.desc }}
              />

              <div className="flex justify-center md:justify-start">
                  <button 
                    onClick={handleDownloadStory} 
                    disabled={downloading}
                    className="inline-flex items-center gap-2 border border-[#8B5E3C] px-6 py-2.5 text-[#8B5E3C] text-[10px] uppercase font-bold tracking-[0.2em] hover:bg-[#8B5E3C] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     <Download className="w-4 h-4" /> 
                     {downloading ? `Đang Tải... ${downloadProgress}%` : `Tải TXT (Trang ${page})`}
                  </button>
              </div>
           </div>
        </div>

        <div>
           <div className="flex flex-col items-center mb-10 text-center">
             <span className="text-[10px] uppercase tracking-[0.2em] text-[#A0998E] font-bold mb-2">Mục lục</span>
             <h2 className="text-3xl font-serif font-black tracking-tighter text-[#2D2D2D]">Danh Sách Chương</h2>
             <div className="h-px w-16 bg-[#8B5E3C] mt-4 mx-auto"></div>
           </div>

           {(story.chapters && story.chapters.length > 0) ? (
               <div className="columns-1 md:columns-2 gap-8 text-sm">
                  {story.chapters.map((c: any, i: number) => (
                     <Link key={i} to={`/story/${slug}/${c.slug}`} className="group flex items-center py-3 border-b border-[#E5E1D8] text-[#6B665E] hover:text-[#2D2D2D] transition-all font-serif">
                        <span className="inline-block w-2 h-2 rounded-full bg-[#8B5E3C] mr-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"></span>
                        <span className="group-hover:translate-x-1 transition-transform line-clamp-1">{c.title}</span>
                     </Link>
                  ))}
               </div>
           ) : (
               <div className="text-center text-[#8B5E3C] italic font-serif py-10">Hiện chưa tải được danh sách chương (hoặc truyện chưa có chương nào).</div>
           )}
           
           {story.totalPages > 1 && (
              <div className="flex flex-wrap justify-center gap-2 mt-12 font-serif text-sm">
                  {Array.from({length: Math.min(10, story.totalPages)}, (_, i) => {
                      let start = Math.max(1, page - 4);
                      let end = Math.min(story.totalPages, start + 9);
                      if (end - start < 9) {
                         start = Math.max(1, end - 9);
                      }
                      let p = start + i;
                      if (p > story.totalPages) return null;
                      return (
                     <button 
                       key={p}
                       onClick={() => setSearchParams({ page: p.toString() })}
                       className={`w-10 h-10 flex items-center justify-center rounded-sm transition-colors border ${p === page ? 'bg-[#2D2D2D] text-white border-[#2D2D2D] shadow-sm' : 'bg-transparent text-[#2D2D2D] border-[#DED9CE] hover:bg-[#EDE9E0]'}`}
                     >
                        {p}
                     </button>
                    )
                  })}
              </div>
           )}
        </div>
     </div>
  );
}

const Chapter = () => {
   const { source } = useContext(SourceContext);
   const { slug, chapter } = useParams();
   const [data, setData] = useState<any>(null);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState(false);
   const [fontSize, setFontSize] = useState(20);
   const navigate = useNavigate();

   useEffect(() => {
     window.scrollTo(0, 0);
     setLoading(true);
     setError(false);
     // Note: for WikiDich, chapter contains slashes, but react-router useParams stringifies it! Wait!
     // In the path we have /story/:slug/*, but wait, the frontend Route was /story/:slug/:chapter ! 
     // For wikiDich, chapterSlug doesn't have slash, it is just `chuong-1...`
     api.get(`/chapter/${slug}/${encodeURIComponent(chapter || '')}?source=${source}`).then(res => {
        setData(res.data);
     }).catch(() => setError(true))
     .finally(() => setLoading(false));
   }, [slug, chapter, source]);

   if (loading) return (
     <div className="min-h-screen bg-[#F9F7F2] flex flex-col items-center justify-center space-y-4">
        <div className="w-8 h-8 rounded-full border-2 border-[#DED9CE] border-t-[#8B5E3C] animate-spin"></div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#8B5E3C] font-bold">Đang tải chương...</div>
     </div>
   );
   
   if (error || !data) return (
     <div className="min-h-screen bg-[#F9F7F2] flex flex-col items-center justify-center space-y-6">
       <div className="text-xl font-serif text-[#8B5E3C] italic">Lỗi khi tải chương. Vui lòng thử lại.</div>
       <button onClick={() => navigate(`/story/${slug}`)} className="px-6 py-2 border border-[#8B5E3C] text-[#8B5E3C] hover:bg-[#8B5E3C] hover:text-white transition-colors uppercase tracking-widest text-[10px] font-bold">Quay lại truyện</button>
     </div>
   );

   const titleStr = data?.title || 'Chương';
   const shortTitle = titleStr.includes(':') ? titleStr.split(':')[0] : titleStr;
   const displayTitle = titleStr.includes(':') ? titleStr.substring(titleStr.indexOf(':') + 1).trim() : (data?.storyTitle || 'Nội dung');

   const handleDownloadTxt = () => {
      const doc = new DOMParser().parseFromString(data?.content || '', 'text/html');
      const textContent = doc.body.textContent || '';
      const fullText = `${data?.storyTitle || 'Truyện'}\n${titleStr}\n\n${textContent.replace(/\n\s*\n/g, '\n\n')}`;
      
      const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data?.storyTitle || 'Truyen'} - ${shortTitle}.txt`;
      a.click();
      URL.revokeObjectURL(url);
   };

   return (
     <div className="flex flex-col min-h-screen w-full bg-[#F9F7F2] text-[#2D2D2D] font-sans">
        <header className="h-16 flex items-center justify-between px-6 md:px-10 border-b border-[#E5E1D8] bg-[#F4F1EA] sticky top-0 z-40 shadow-sm">
            <div className="flex items-center gap-6 text-[10px] uppercase tracking-[0.2em] font-bold text-[#8B5E3C]">
                <button onClick={() => navigate(`/story/${slug}`)} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                    <ArrowLeft className="w-4 h-4" /> TRỞ VỀ
                </button>
                <div className="hidden sm:block h-4 w-px bg-[#DED9CE]"></div>
                <span className="hidden sm:inline font-serif font-black italic text-sm normal-case text-[#2D2D2D] line-clamp-1">{data?.storyTitle || 'Truyện'}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0">
                <button onClick={handleDownloadTxt} className="hidden sm:flex items-center gap-2 px-3 py-1.5 text-[#8B5E3C] hover:bg-[#8B5E3C] hover:text-white border border-[#8B5E3C] transition-colors rounded-sm text-[10px] uppercase font-bold tracking-widest" title="Tải chương hiện tại (TXT)">
                   <Download className="w-3.5 h-3.5" /> TẢI TXT
                </button>
                <div className="flex border border-[#E5E1D8] rounded-sm overflow-hidden bg-white shadow-sm">
                    <button onClick={() => setFontSize(f => Math.max(14, f - 2))} className="px-4 py-1.5 bg-white text-xs border-r border-[#E5E1D8] hover:bg-[#F9F7F2] hover:text-[#8B5E3C] text-[#2D2D2D] font-serif transition-colors">A-</button>
                    <button onClick={() => setFontSize(f => Math.min(32, f + 2))} className="px-4 py-1.5 bg-white hover:bg-[#F9F7F2] hover:text-[#8B5E3C] text-xs text-[#2D2D2D] font-serif transition-colors">A+</button>
                </div>
            </div>
        </header>

        <section className="flex-1 overflow-visible px-6 py-12 md:py-20 bg-[#F9F7F2]">
          <div className="max-w-3xl mx-auto">
            <div className="mb-16 text-center">
              <span className="font-serif italic text-xl md:text-2xl text-[#8B5E3C]">{shortTitle}</span>
              <h2 className="text-4xl md:text-5xl font-serif font-black mt-4 mb-8 tracking-tighter leading-tight text-[#2D2D2D]">
                {displayTitle}
              </h2>
              <div className="h-px w-24 bg-[#DED9CE] mx-auto"></div>
            </div>

            <div 
                className="columns-1 text-[#3D3D3D] font-serif chapter-content leading-loose text-justify"
                style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: data?.content || '<p>Trống</p>' }}
            />
          </div>
        </section>

        <footer className="bg-[#F4F1EA] border-t border-[#E5E1D8] flex items-center px-4 md:px-12 py-6 md:h-24 pb-8 md:pb-6 relative w-full mt-auto">
          <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
            <button 
              disabled={!data.prevSlug}
              onClick={() => navigate(`/story/${slug}/${encodeURIComponent(data.prevSlug || '')}`)}
              className="group flex items-center gap-4 disabled:opacity-30 disabled:cursor-not-allowed text-left"
            >
              <div className="w-10 h-10 rounded-full border border-[#DED9CE] shrink-0 flex items-center justify-center group-hover:bg-[#8B5E3C] group-hover:border-[#8B5E3C] group-hover:text-white transition-all bg-white text-[#8B5E3C]">
                  <ChevronLeft className="w-5 h-5"/>
              </div>
              <div className="hidden sm:block">
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#A0998E] mb-1">Chương trước</div>
                <div className="text-xs font-bold font-serif text-[#2D2D2D] group-hover:text-[#8B5E3C] transition-colors">Phần trước</div>
              </div>
            </button>

            <div className="text-center px-4 flex-1">
               <div className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#A0998E] mb-1">Nguồn</div>
               <div className="text-[11px] italic font-serif text-[#8B5E3C] uppercase">{source === 'wikidich' ? 'Wiki Dịch' : 'Truyện Full'}</div>
            </div>

            <button 
              disabled={!data.nextSlug}
              onClick={() => navigate(`/story/${slug}/${encodeURIComponent(data.nextSlug || '')}`)}
              className="group flex items-center gap-4 text-right disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <div className="hidden sm:block">
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#A0998E] mb-1">Chương sau</div>
                <div className="text-xs font-bold font-serif text-[#2D2D2D] group-hover:text-[#8B5E3C] transition-colors">Phần tiếp theo</div>
              </div>
              <div className="w-10 h-10 rounded-full border border-[#DED9CE] shrink-0 flex items-center justify-center group-hover:bg-[#8B5E3C] group-hover:border-[#8B5E3C] group-hover:text-white transition-all bg-white text-[#8B5E3C]">
                  <ChevronRight className="w-5 h-5"/>
              </div>
            </button>
          </div>
        </footer>
     </div>
   );
}

const StoryList = () => {
   const { source } = useContext(SourceContext);
   const { type } = useParams();
   const [searchParams, setSearchParams] = useSearchParams();
   const page = parseInt(searchParams.get('page') || '1');
   const [data, setData] = useState<any>(null);
   const [loading, setLoading] = useState(true);

   useEffect(() => {
     setLoading(true);
     api.get(`/list/${type}?page=${page}&source=${source}`).then(res => {
        setData(res.data);
     }).catch(() => {
        setData({ error: true, results: [] });
     }).finally(() => setLoading(false));
   }, [type, page, source]);

   return (
    <div className="max-w-4xl mx-auto px-6 py-12">
       {loading ? <Loading /> : (
          <>
             <div className="flex flex-col items-center mb-10 text-center">
               <span className="font-serif italic text-lg text-[#8B5E3C]">Danh sách truyện</span>
               <h1 className="text-4xl font-serif font-black mt-2 mb-4 tracking-tighter text-[#2D2D2D]">{data?.title || 'Danh Sách'}</h1>
               <div className="h-px w-24 bg-[#DED9CE] mx-auto"></div>
             </div>

             <div className="bg-[#F4F1EA] border border-[#E5E1D8] shadow-inner p-6 rounded-sm">
                {(!data?.results || data.results.length === 0) ? (
                  <div className="p-12 text-center text-[#6B665E] font-serif italic">Không tìm thấy truyện nào.</div>
                ) : (
                  data.results.map((r: any, i: number) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between py-5 border-b border-[#E5E1D8] last:border-0 gap-3 group transition-colors">
                       <Link to={`/story/${r.slug}`} className="font-serif font-black text-[#2D2D2D] group-hover:text-[#8B5E3C] text-xl transition-colors">{r.title}</Link>
                       <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6 text-sm text-[#6B665E] font-serif italic">
                         <span className="sm:w-32 truncate">{r.author}</span>
                         {r.latestChapterSlug ? (
                         <Link to={`/story/${r.slug}/${r.latestChapterSlug}`} className="sm:w-32 sm:text-right font-sans not-italic text-xs font-bold uppercase tracking-wider text-[#8B5E3C] hover:underline">{r.latestChapter}</Link>
                         ) : (
                         <span className="sm:w-32 sm:text-right font-sans not-italic text-xs font-bold uppercase tracking-wider text-[#8B5E3C] truncate">{r.latestChapter}</span>
                         )}
                       </div>
                    </div>
                  ))
                )}
             </div>

             {data?.totalPages > 1 && (
                <div className="flex flex-wrap justify-center gap-2 mt-12 font-serif text-sm">
                   {Array.from({length: Math.min(10, data.totalPages)}, (_, i) => {
                      let start = Math.max(1, page - 4);
                      let end = Math.min(data.totalPages, start + 9);
                      if (end - start < 9) {
                         start = Math.max(1, end - 9);
                      }
                      let p = start + i;
                      if (p > data.totalPages) return null;
                      return (
                         <button 
                           key={p}
                           onClick={() => setSearchParams({ page: p.toString() })}
                           className={`w-10 h-10 flex items-center justify-center rounded-sm transition-colors border ${p === page ? 'bg-[#2D2D2D] text-white border-[#2D2D2D] shadow-sm' : 'bg-transparent text-[#2D2D2D] border-[#DED9CE] hover:bg-[#EDE9E0]'}`}
                         >
                            {p}
                         </button>
                      )
                   }).filter(Boolean)}
                </div>
             )}
          </>
       )}
    </div>
  )
}

const ContextWrapper = ({ children }: { children: React.ReactNode }) => {
  const [source, setSourceState] = useState<string>(() => localStorage.getItem('novel_source') || 'truyenfull');
  
  const setSource = (s: string) => {
    setSourceState(s);
    localStorage.setItem('novel_source', s);
  };

  return (
    <SourceContext.Provider value={{ source, setSource }}>
      {children}
    </SourceContext.Provider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ContextWrapper>
        <Router>
          <div className="min-h-screen bg-[#F9F7F2] text-[#2D2D2D] font-sans selection:bg-[#8B5E3C] selection:text-white">
            <Routes>
               <Route path="/story/:slug/:chapter" element={<Chapter />} />
               <Route path="*" element={
                  <>
                     <Navbar />
                     <main>
                       <Routes>
                          <Route path="/" element={<Home />} />
                          <Route path="/search" element={<Search />} />
                          <Route path="/list/:type" element={<StoryList />} />
                          <Route path="/story/:slug" element={<StoryDetails />} />
                       </Routes>
                     </main>
                  </>
               } />
            </Routes>
          </div>
        </Router>
      </ContextWrapper>
    </ErrorBoundary>
  );
}
