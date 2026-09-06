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
    const [image, setImage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [parsedData, setParsedData] = useState(null);
    const [cards, setCards] = useState([]);
    const [error, setError] = useState(null);
    const [editingId, setEditingId] = useState(null);
    const [editData, setEditData] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    const handleImageUpload = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (image) URL.revokeObjectURL(image);
        setImage(URL.createObjectURL(file));
        setLoading(true);
        setError(null);

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = async () => {
            try {
                const base64DataSegment = reader.result.split(",")[1];
                const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

                if (!apiKey) {
                    throw new Error("VITE_GEMINI_API_KEY not found in .env.local");
                }

                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

                const response = await fetch(apiUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { 
                                    text: "Extract details from this business card. Return ONLY a raw valid JSON object with no markdown formatting. Schema: { \"name\": \"\", \"title\": \"\", \"company\": \"\", \"phone\": \"\", \"email\": \"\" }" 
                                },
                                { 
                                    inlineData: { 
                                        mimeType: file.type, 
                                        data: base64DataSegment 
                                    } 
                                }
                            ]
                        }]
                    })
                });

                if (!response.ok) {
                    const textErr = await response.text();
                    console.error("API Error:", textErr);
                    throw new Error(`Google API error: ${response.status}`);
                }

                const resData = await response.json();
                let aiTextResponse = resData.candidates[0].content.parts[0].text;
                
                // Clean markdown if present
                aiTextResponse = aiTextResponse
                    .replace(/```json/gi, "")
                    .replace(/```/g, "")
                    .trim();
                
                console.log("Cleaned AI response:", aiTextResponse); // Debug
                
                const parsedJson = JSON.parse(aiTextResponse);
                setParsedData({
                    name: toTitleCase(parsedJson.name || ""),
                    title: parsedJson.title || "",
                    company: parsedJson.company || "",
                    phone: parsedJson.phone || "", 
                    email: (parsedJson.email || "").toLowerCase(), 
                    notes: ""
                });

            } catch (err) {
                console.error("Error:", err);
                setError(`Error: ${err.message}`);
            } finally {
                setLoading(false);
            }
        };
    };

    const handleSave = async () => {
        if (!parsedData) return;
        try {
            const { error: insertError } = await supabase
                .from("businesscards")
                .insert([parsedData]);
            if (insertError) throw insertError;
            alert("Card saved!");
            if (image) URL.revokeObjectURL(image);
            setParsedData(null);
            setImage(null);
            fetchCards();
        } catch (err) {
            setError(`Save failed: ${err.message}`);
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
   
    return (
        <div className="container">
            <h1>Business Card Scanner</h1>
            
            
            <div className="upload-section">
            <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                disabled={loading}
            />
            {loading && <p className="loading-text">Processing image with Gemini...</p>}
            </div>


            {image && (
                <div className="preview-section">
                    <img src={image} alt="Business Card" className="preview-image" />
                </div>
            )}

            {error && <div className="error-box"><p className="error">{error}</p></div>}

            {parsedData && (
                <div className="parsed-section">
                    <h2>Extracted Data</h2>
                    <div className="form">
                        <label>Name</label>
                        <input
                            type="text"
                            value={parsedData.name}
                            onChange={(e) => setParsedData({ ...parsedData, name: e.target.value })}
                        />
                        <label>Title</label>
                        <input
                            type="text"
                            value={parsedData.title}
                            onChange={(e) => setParsedData({ ...parsedData, title: e.target.value })}
                        />
                        <label>Company</label>
                        <input
                            type="text"
                            value={parsedData.company}
                            onChange={(e) => setParsedData({ ...parsedData, company: e.target.value })}
                        />
                        <label>Phone</label>
                        <input
                            type="text"
                            value={parsedData.phone}
                            onChange={(e) => setParsedData({ ...parsedData, phone: e.target.value })}
                        />
                        <label>Email</label>
                        <input
                            type="text"
                            value={parsedData.email}
                            onChange={(e) => setParsedData({ ...parsedData, email: e.target.value })}
                        />
                        <label>Notes</label>
                        <textarea
                            value={parsedData.notes}
                            onChange={(e) => setParsedData({ ...parsedData, notes: e.target.value })}
                            placeholder="Where did you meet them? What did you discuss?"
                        />
                        <button onClick={handleSave}>Save Card</button>
                    </div>
                </div>
            )}

            <div className="cards-section">
  <h2>Saved Cards ({cards.length})</h2>
  
  <div className="search-section">
    <input
        type="text"
        placeholder="Search by name, company, or email..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="search-input"
    />
    <p>{filteredCards.length} of {cards.length} cards found</p>
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
            e.stopPropagation(); // Prevents triggering row clicks accidentally
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

        </div>
    );
}