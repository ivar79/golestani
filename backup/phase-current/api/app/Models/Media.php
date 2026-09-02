<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class Media extends Model { protected $table='media'; protected $fillable=['path','original_name','mime_type','file_size']; }
