import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API } from '@/lib/api';
import { Modal } from './Modal';
import { Icon } from '@/components/atoms/Icon';
import { useToast } from '@/components/atoms/Toast';

export function CreateListingSheet({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('');
  const [look, setLook] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const qc = useQueryClient();

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await API.uploadPhoto(file);
      setPhotos((p) => [...p, url]);
    } catch (err) {
      showToast((err as Error).message || 'Photo upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      API.createListing({
        title: title.trim(),
        description: desc.trim(),
        quantity: qty.trim(),
        photos,
        lookingFor: look.trim() || undefined,
        expiresInDays,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings'] });
      qc.invalidateQueries({ queryKey: ['my-listings'] });
      showToast('Listing created');
      onClose();
    },
    onError: (e: Error) => showToast(e.message || 'Could not create listing'),
  });

  return (
    <Modal onClose={onClose}>
      <h2>List Your Produce</h2>
      <label className="field-label">What are you sharing?</label>
      <input className="input" placeholder="e.g., Fresh Tomatoes" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginTop: 6 }} />
      <label className="field-label" style={{ marginTop: 12 }}>Description</label>
      <textarea className="input" placeholder="Tell others about it…" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ marginTop: 6 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label className="field-label">Quantity</label>
          <input className="input" placeholder="10 lbs" value={qty} onChange={(e) => setQty(e.target.value)} style={{ marginTop: 6 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Looking for</label>
          <input className="input" placeholder="eggs, bread" value={look} onChange={(e) => setLook(e.target.value)} style={{ marginTop: 6 }} />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Expires in</label>
      <div className="segmented" style={{ marginTop: 6 }}>
        {[3, 7, 14].map((d) => (
          <button key={d} className={expiresInDays === d ? 'active' : ''} onClick={() => setExpiresInDays(d)}>
            {d} days
          </button>
        ))}
      </div>
      <label className="field-label" style={{ marginTop: 14 }}>Photos</label>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickPhoto} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 6 }}>
        {photos.map((url) => (
          <img key={url} src={url} alt="" style={{ aspectRatio: '1/1', width: '100%', objectFit: 'cover', borderRadius: 'var(--radius)' }} />
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{ aspectRatio: '1/1', background: 'var(--muted)', border: '2px dashed var(--border)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}
        >
          {uploading ? '…' : Icon.plus(28)}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn btn-outline" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!title.trim() || !desc.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Creating…' : 'Create Listing'}
        </button>
      </div>
    </Modal>
  );
}
