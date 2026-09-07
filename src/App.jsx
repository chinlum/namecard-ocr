import React, { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import "./App.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function toTitleCase(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export default function App() {
    const [uploadQueue, setUploadQueue] = useState([]);       
    const [currentProcessingIndex, setCurrentProcessingIndex] = useState(-1); 
    const [pendingReviewCards, setPendingReviewCards] = useState([]); 
    const [cards, setCards] = useState([]);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editData, setEditData] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    const [session, setSession] = useState(null);
    const [authEmail, setAuthEmail] = useState('');
    const [authPassword, setAuthPassword] = useState('');
    const [isSignUp, setIsSignUp] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);

    const handleImageUpload = (event) => {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;
  setError(null);

  const newQueueItems = files.map((file) => ({
    file: file,
    previewUrl: URL.createObjectURL(file),
    status: 'Waiting...', 
  }));

  const updatedQueue = [...uploadQueue, ...newQueueItems];
  setUploadQueue(updatedQueue);

  if (currentProcessingIndex === -1) {
    processNextItem(0, updatedQueue);
  }
};

const processNextItem = async (index, currentQueue) => {
  if (index >= currentQueue.length) {
    setCurrentProcessingIndex(-1);
    return;
  }

  setCurrentProcessingIndex(index);
  setUploadQueue(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'Processing...' } : item));

  const targetItem = currentQueue[index];
  const file = targetItem.file;
  const reader = new FileReader();
  
  reader.readAsDataURL(file);
  reader.onloadend = async () => {
    try {
      const base64DataSegment = reader.result.split(",")[1];
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey) throw new Error("VITE_GEMINI_API_KEY not found in .env.local");

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: "Extract details from this business card. Return ONLY a raw valid JSON object with no markdown formatting. Schema: { \"name\": \"\", \"title\": \"\", \"company\": \"\", \"phone\": \"\", \"email\": \"\" }" },
              { inlineData: { mimeType: file.type, data: base64DataSegment } }
            ]
          }]
        })
      });

      if (!response.ok) throw new Error(`Google API error status: ${response.status}`);
      
      const resData = await response.json();
      let aiTextResponse = resData.candidates[0].content.parts[0].text;
      aiTextResponse = aiTextResponse.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsedJson = JSON.parse(aiTextResponse);
      
      const extractedCard = {
        id: Date.now() + index, 
        name: toTitleCase(parsedJson.name || ""),
        title: toTitleCase(parsedJson.title || ""),
        company: toTitleCase(parsedJson.company || ""),
        phone: parsedJson.phone || "",
        email: (parsedJson.email || "").toLowerCase(),
        notes: "",
        previewUrl: targetItem.previewUrl
      };

      setPendingReviewCards(prev => [...prev, extractedCard]);
      setUploadQueue(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'Done ✅' } : item));
    } catch (err) {
      console.error(err);
      setUploadQueue(prev => prev.map((item, idx) => idx === index ? { ...item, status: 'Failed ❌' } : item));
      setError(`Failed to extract a card: ${err.message}`);
    } finally {
        processNextItem(index + 1, currentQueue);
    }
  };
};
  
const handleBulkSave = async () => {
  if (pendingReviewCards.length === 0) return;
  try {
    // Remove the temporary local preview image strings right before database insertion
    const cardsToSave = pendingReviewCards.map(({ id, previewUrl, ...rest }) => rest);
    
    const { error: insertError } = await supabase
      .from("businesscards")
      .insert(cardsToSave);
      
    if (insertError) throw insertError;
    
    alert(`Successfully saved ${pendingReviewCards.length} cards!`);
    
    uploadQueue.forEach(item => URL.revokeObjectURL(item.previewUrl));
    setPendingReviewCards([]);
    setUploadQueue([]);
    fetchCards(); 
  } catch (err) {
    setError(`Bulk save failed: ${err.message}`);
  }
};

const handleRemovePendingCard = (id) => {
  setPendingReviewCards(prev => prev.filter(c => c.id !== id));
};

React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
    });
    return () => subscription.unsubscribe();
}, []);

React.useEffect(() => {
    if (session) {
        fetchCards();
    }
}, [session]);

const handleAuthAction = async (e) => {
    e.preventDefault();
    setError(null);
    setAuthLoading(true);
    try {
        if (isSignUp) {
            const { error: signUpError } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
            if (signUpError) throw signUpError;
            alert("Registration complete! Check your email inbox for a validation link.");
        } else {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
            if (signInError) throw signInError;
        }
    } catch (err) {
        setError(`Authentication failed: ${err.message}`);
    } finally {
        setAuthLoading(false);
    }
};

    const fetchCards = async () => {
        try {
            const { data, error: fetchError } = await supabase
                .from("businesscards")
                .select("*")
                .order('name', { ascending: true });
            if (fetchError) throw fetchError;
            setCards(data);
        } catch (err) {
            setError(`Fetch failed: ${err.message}`);
        }
    };

    React.useEffect(() => {
        fetchCards();
    }, []);

    const handleEdit = (card) => {
      setEditingId(card.id);
      setEditData(card);
    };

    const handleEditSave = async () => {
      try {
        const { error: updateError } = await supabase
          .from('businesscards')
          .update(editData)
          .eq('id', editingId);
        if (updateError) throw updateError;
        alert('Card updated!');
        setEditingId(null);
        fetchCards();
      } catch (err) {
        setError(`Update failed: ${err.message}`);
      }
    };

    const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this card?')) return;
    try {
        const { error: deleteError } = await supabase
        .from('businesscards')
        .delete()
        .eq('id', id);
        if (deleteError) throw deleteError;
        alert('Card deleted!');
        fetchCards();
    } catch (err) {
        setError(`Delete failed: ${err.message}`);
    }
    };
 
    const filteredCards = cards.filter((card) =>
    card.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    card.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    card.email?.toLowerCase().includes(searchTerm.toLowerCase())
    );
   
    const exportToCSV = () => {
  // 1. Define the spreadsheet columns
  const headers = ['Name', 'Title', 'Company', 'Phone', 'Email', 'Notes', 'Date Added'];
  
  // 2. Convert your saved cards into text rows
  const rows = cards.map(card => [
    `"${(card.name || '').replace(/"/g, '""')}"`,
    `"${(card.title || '').replace(/"/g, '""')}"`,
    `"${(card.company || '').replace(/"/g, '""')}"`,
    `"${(card.phone || '').replace(/"/g, '""')}"`,
    `"${(card.email || '').replace(/"/g, '""')}"`,
    `"${(card.notes || '').replace(/"/g, '""')}"`,
    `"${card.created_at ? new Date(card.created_at).toLocaleDateString() : '-'}"`
  ]);

  // 3. Join everything together with commas and clean line breaks
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

  // 4. Create a hidden browser link to trigger the download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `business_cards_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};


    return (
        <div className="container">
            {!session ? (
                /* 🔐 RENDER THIS CUSTOM LOGIN FORM IF USER IS OUT */
                <div style={{ maxWidth: '420px', margin: '50px auto', padding: '25px', background: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>
                        {isSignUp ? '📝 Register New Profile' : '🔐 Business Card Scanner Login'}
                    </h2>
                    
                    <form onSubmit={handleAuthAction} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontWeight: 'bold', fontSize: '14px' }}>Email Address</label>
                            <input type="email" required placeholder="name@example.com" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <label style={{ fontWeight: 'bold', fontSize: '14px' }}>Password</label>
                            <input type="password" required placeholder="••••••••" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
                        </div>
                        <button type="submit" disabled={authLoading} style={{ background: '#007bff', color: 'white', padding: '12px', fontSize: '16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px' }}>
                            {authLoading ? 'Connecting...' : isSignUp ? 'Sign Up' : 'Log In'}
                        </button>
                    </form>
                    <p style={{ marginTop: '25px', textAlign: 'center', fontSize: '14px', color: '#666' }}>
                        {isSignUp ? 'Already have an account?' : 'Need an account for your cards?'} {' '}
                        <span onClick={() => setIsSignUp(!isSignUp)} style={{ color: '#007bff', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'underline' }}>
                            {isSignUp ? 'Sign In Here' : 'Create One Here'}
                        </span>
                    </p>
                </div>
            ) : (
                /* 🔓 RENDER MAIN DASHBOARD VIEW IF USER IS LOGGED IN */
                <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h1>Business Card Scanner</h1>
                        <button onClick={() => supabase.auth.signOut()} style={{ background: '#6c757d', color: 'white', padding: '8px 16px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                            Logout 🚪
                        </button>
                    </div>

        {/* Batch Review Section */}
        {pendingReviewCards.length > 0 && (
            <div className="parsed-section" style={{ border: '2px solid #007bff', background: '#f8f9fa' }}>
                <h2>📋 Batch Review Panel ({pendingReviewCards.length} Cards Extracted)</h2>
                <p>Verify or tweak entries below before pushing the batch to your live database.</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', margin: '20px 0' }}>
                    {pendingReviewCards.map((card) => (
                        <div key={card.id} style={{ display: 'flex', gap: '15px', background: 'white', padding: '15px', borderRadius: '6px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                            <img src={card.previewUrl} alt="Card Preview" style={{ width: '120px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #ccc' }} />
                            
                            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <input type="text" value={card.name} placeholder="Name" onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, name: e.target.value} : c))} />
                                <input type="text" value={card.title} placeholder="Title" onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, title: e.target.value} : c))} />
                                <input type="text" value={card.company} placeholder="Company" onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, company: e.target.value} : c))} />
                                <input type="text" value={card.phone} placeholder="Phone" onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, phone: e.target.value} : c))} />
                                <input type="text" value={card.email} placeholder="Email" style={{ gridColumn: 'span 2' }} onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, email: e.target.value} : c))} />
                                <input type="text" value={card.notes} placeholder="Add notes..." style={{ gridColumn: 'span 2' }} onChange={(e) => setPendingReviewCards(prev => prev.map(c => c.id === card.id ? {...c, notes: e.target.value} : c))} />
                            </div>
                            
                            <button onClick={() => handleRemovePendingCard(card.id)} style={{ background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', width: '35px', height: '35px', cursor: 'pointer', alignSelf: 'center' }}>✕</button>
                        </div>
                    ))}
                </div>
                
                <button onClick={handleBulkSave} style={{ background: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px', padding: '12px 24px', width: '100%' }}>
                    💾 Save All Verified Cards to Database
                </button>
            </div>
        )}
        
        {/* Global Error Banner */}
        {error && <div className="error-box"><p className="error">{error}</p></div>}

        {/* Master Output Section */}
        <div className="cards-section">
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            
            <h2>Saved Cards ({cards.length})</h2>
  
            <button 
                onClick={exportToCSV} 
                style={{ background: '#28a745', color: 'white', padding: '10px 18px', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                disabled={cards.length === 0} // Button stays locked if the database is empty
            >
            📥 Export to CSV
            </button>
            
            </div>
            
            <div className="search-section">
                <input
                    type="text"
                    placeholder="Search by name, company, or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                />
                <p style={{ marginTop: '5px', fontSize: '14px', color: '#666' }}>{filteredCards.length} of {cards.length} cards found</p>
            </div>
            
            <div className="table-responsive">
                <table className="cards-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Title</th>
                            <th>Company</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>Notes</th>
                            <th>Actions</th> {/* 🎯 ADDED TO ALIGN WITH BUTTONS TRACK ROW */}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredCards.map((card) => (
                            editingId === card.id ? (
                                <tr key={card.id} className="editing-row">
                                    <td><input type="text" value={editData.name || ""} onChange={(e) => setEditData({...editData, name: e.target.value})} /></td>
                                    <td><input type="text" value={editData.title || ""} onChange={(e) => setEditData({...editData, title: e.target.value})} /></td>
                                    <td><input type="text" value={editData.company || ""} onChange={(e) => setEditData({...editData, company: e.target.value})} /></td>
                                    <td><input type="text" value={editData.phone || ""} onChange={(e) => setEditData({...editData, phone: e.target.value})} /></td>
                                    <td><input type="text" value={editData.email || ""} onChange={(e) => setEditData({...editData, email: e.target.value})} /></td>
                                    <td><input type="text" value={editData.notes || ""} onChange={(e) => setEditData({...editData, notes: e.target.value})} placeholder="Edit notes..." /></td>
                                    <td className="action-buttons-cell">
                                        <button onClick={handleEditSave} className="save-btn">Save</button>
                                        <button onClick={() => setEditingId(null)} className="cancel-btn">Cancel</button>
                                        <button onClick={(e) => { 
                                            e.stopPropagation(); 
                                            handleDelete(card.id); 
                                        }} className="delete-btn">Delete</button>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={card.id} onClick={() => handleEdit(card)} style={{cursor: 'pointer'}}>
                                    <td><strong>{card.name}</strong></td>
                                    <td>{card.title}</td>
                                    <td>{card.company}</td>
                                    <td>{card.phone}</td>
                                    <td>{card.email}</td>
                                    <td>{card.notes || '-'}</td>
                                    <td></td>
                                </tr>
                            )
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </>
)}
        </div>
    );
}