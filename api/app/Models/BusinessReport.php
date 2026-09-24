<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessReport extends Model
{
    use HasFactory;

    protected $fillable = ['business_id', 'reporter_id', 'type', 'message', 'status', 'admin_note'];

    public function business(): BelongsTo { return $this->belongsTo(Business::class); }
    public function reporter(): BelongsTo { return $this->belongsTo(User::class, 'reporter_id'); }
}
